bl_info = {
    "name": "Pigmi: UV to Palette",
    "author": "Oleg Pavlov",
    "version": (1, 16, 9),
    "blender": (5, 0, 0),
    "location": "3D View > Sidebar > Snap UV",
    "description": (
        "Moves selected UVs to palette cells and maps palette gradients by line, radius, or distance."
    ),
    "category": "UV",
}

import bpy
import bmesh
import math
import time
import json
import numpy as np
from array import array
from types import SimpleNamespace
from mathutils import Vector, Quaternion
from mathutils.bvhtree import BVHTree
from bpy_extras import view3d_utils

# --- Helper functions ---

path_gradient_draw_handle = None
easy_selection_draw_handle = None
uv_box_draw_handle = None
uv_box_preview_area = None
uv_box_preview_points = None


def draw_uv_box_selection_overlay():
    draw_active_palette_cell()
    if uv_box_preview_points is None or bpy.context.area != uv_box_preview_area:
        return

    import gpu
    from gpu_extras.batch import batch_for_shader

    start, end = uv_box_preview_points
    xmin, xmax = sorted((start.x, end.x))
    ymin, ymax = sorted((start.y, end.y))
    corners = [
        (xmin, ymin), (xmax, ymin), (xmax, ymax), (xmin, ymax)]
    shader = gpu.shader.from_builtin('UNIFORM_COLOR')

    gpu.state.blend_set('ALPHA')
    try:
        fill = batch_for_shader(
            shader, 'TRIS', {"pos": corners},
            indices=[(0, 1, 2), (0, 2, 3)])
        shader.bind()
        shader.uniform_float("color", (0.18, 0.48, 1.0, 0.16))
        fill.draw(shader)

        outline_vertices = [
            corners[0], corners[1], corners[1], corners[2],
            corners[2], corners[3], corners[3], corners[0],
        ]
        outline = batch_for_shader(shader, 'LINES', {"pos": outline_vertices})
        shader.bind()
        shader.uniform_float("color", (0.38, 0.68, 1.0, 0.95))
        outline.draw(shader)
    finally:
        gpu.state.blend_set('NONE')


def set_uv_box_preview(area, start, end):
    global uv_box_preview_area, uv_box_preview_points
    uv_box_preview_area = area
    uv_box_preview_points = (start.copy(), end.copy())
    if area is not None:
        area.tag_redraw()


def clear_uv_box_preview():
    global uv_box_preview_area, uv_box_preview_points
    area = uv_box_preview_area
    uv_box_preview_area = None
    uv_box_preview_points = None
    if area is not None:
        try:
            area.tag_redraw()
        except ReferenceError:
            pass


def draw_palette_overlays():
    draw_path_gradient_overlay()
    draw_gradient_snap_target()


def draw_path_gradient_overlay():
    draw_editable_gradient_overlay()
    scene = bpy.context.scene
    if scene is None or not hasattr(scene, "snap_uv_path_points"):
        return
    screen_points = deserialize_screen_points(getattr(scene, "snap_uv_path_screen_points", ""))
    if len(screen_points) < 2:
        points = deserialize_path_points(scene.snap_uv_path_points)
        region = bpy.context.region
        space = bpy.context.space_data
        rv3d = getattr(space, "region_3d", None)
        if len(points) < 2 or region is None or rv3d is None:
            return
        screen_points = []
        for point in points:
            screen_point = view3d_utils.location_3d_to_region_2d(region, rv3d, point)
            if screen_point is not None:
                screen_points.append(screen_point)
    if len(screen_points) < 2:
        return

    import gpu
    from gpu_extras.batch import batch_for_shader

    if getattr(scene, "snap_uv_path_style", "FREEHAND") == 'FREEHAND':
        screen_points = filter_screen_points(screen_points, min_distance=4.0)
    elif scene.snap_uv_path_style == 'STRAIGHT':
        screen_points = [screen_points[0], screen_points[-1]]

    gpu.state.blend_set('ALPHA')
    gpu.state.depth_test_set('NONE')

    outer_shader = gpu.shader.from_builtin('UNIFORM_COLOR')
    for width, alpha in ((20.0, 0.42), (16.0, 0.94)):
        outer_batch = build_screen_polyline_batch(batch_for_shader, screen_points, width)
        if outer_batch is not None:
            outer_shader.bind()
            outer_shader.uniform_float("color", (1.0, 1.0, 1.0, alpha))
            outer_batch.draw(outer_shader)
        draw_path_round_joins(batch_for_shader, outer_shader, screen_points, width * 0.5, (1.0, 1.0, 1.0, alpha))

    inner_shader = gpu.shader.from_builtin('SMOOTH_COLOR')
    gradient_points = color_sampled_screen_points(screen_points)
    inner_batch = build_screen_polyline_batch(batch_for_shader, gradient_points, 10.5, gradient=True)
    if inner_batch is not None:
        inner_shader.bind()
        inner_batch.draw(inner_shader)
    draw_path_gradient_joins(batch_for_shader, gradient_points, 5.25)

    draw_path_endpoint(batch_for_shader, outer_shader, screen_points[0], 12.0, (1.0, 1.0, 1.0, 1.0))
    draw_path_endpoint(batch_for_shader, outer_shader, screen_points[-1], 12.0, (1.0, 1.0, 1.0, 1.0))
    draw_path_endpoint(batch_for_shader, outer_shader, screen_points[0], 8.0, preview_gradient_color(0.0))
    draw_path_endpoint(batch_for_shader, outer_shader, screen_points[-1], 8.0, preview_gradient_color(1.0))

    gpu.state.depth_test_set('NONE')
    gpu.state.blend_set('NONE')


def preview_gradient_color(factor):
    factor = max(0.0, min(1.0, factor))
    scene = bpy.context.scene
    colors = deserialize_gradient_colors(getattr(scene, "snap_uv_path_colors", "")) if scene else []
    if colors:
        if len(colors) == 1:
            return colors[0]
        scaled = factor * (len(colors) - 1)
        index = int(math.floor(scaled))
        if index >= len(colors) - 1:
            return colors[-1]
        local = scaled - index
        left_color = Vector(colors[index])
        right_color = Vector(colors[index + 1])
        color = left_color.lerp(right_color, local)
        return (color.x, color.y, color.z, color.w)
    left = Vector((0.95, 0.12, 0.72, 1.0))
    right = Vector((0.18, 0.12, 0.82, 1.0))
    color = left.lerp(right, factor)
    return (color.x, color.y, color.z, color.w)


def smooth_screen_points(points, iterations=1):
    if len(points) < 3:
        return points
    smoothed = [Vector((point.x, point.y)) for point in points]
    for _index in range(iterations):
        next_points = [smoothed[0]]
        for index in range(len(smoothed) - 1):
            start = smoothed[index]
            end = smoothed[index + 1]
            next_points.append(start.lerp(end, 0.25))
            next_points.append(start.lerp(end, 0.75))
        next_points.append(smoothed[-1])
        smoothed = next_points
    return smoothed


def filter_screen_points(points, min_distance=2.0):
    if len(points) < 3:
        return points
    filtered = [points[0]]
    for point in points[1:-1]:
        if (point - filtered[-1]).length >= min_distance:
            filtered.append(point)
    if (points[-1] - filtered[-1]).length >= 0.001:
        filtered.append(points[-1])
    return filtered


def polyline_length(points):
    total = 0.0
    for index in range(len(points) - 1):
        total += (points[index + 1] - points[index]).length
    return total


def point_on_polyline(points, progress):
    if len(points) < 2:
        return points[0] if points else Vector((0.0, 0.0))
    progress = max(0.0, min(1.0, progress))
    total_length = polyline_length(points)
    if total_length <= 1e-6:
        return points[0]
    target_distance = progress * total_length
    walked = 0.0
    for index in range(len(points) - 1):
        start = points[index]
        end = points[index + 1]
        segment_length = (end - start).length
        if segment_length <= 1e-6:
            continue
        if walked + segment_length >= target_distance:
            local = (target_distance - walked) / segment_length
            return start.lerp(end, local)
        walked += segment_length
    return points[-1]


def color_sampled_screen_points(points):
    if len(points) < 2:
        return points
    scene = bpy.context.scene
    colors = deserialize_gradient_colors(getattr(scene, "snap_uv_path_colors", "")) if scene else []
    sample_count = max(2, min(128, len(colors) if colors else 24))
    path_length = polyline_length(points)
    if path_length > 1e-6:
        sample_count = max(sample_count, min(128, int(path_length / 12.0) + 1))
    return [point_on_polyline(points, index / max(1, sample_count - 1))
            for index in range(sample_count)]


def stabilized_screen_point(previous, current, strength):
    if previous is None:
        return current
    strength = max(0.0, min(0.95, strength))
    follow = 1.0 - strength
    return previous.lerp(current, follow)


def smooth_freehand_screen_points(points, strength):
    if len(points) < 3 or strength <= 0.0:
        return points
    min_distance = 2.0 + strength * 4.0
    filtered = filter_screen_points(points, min_distance=min_distance)
    iterations = 1 if strength < 0.65 else 2
    return smooth_screen_points(filtered, iterations=iterations)


def build_screen_polyline_batch(batch_for_shader, points, width, gradient=False, point_colors=None):
    import gpu

    vertices = []
    colors = []
    indices = []
    half_width = width * 0.5
    segment_count = max(1, len(points) - 1)

    for index in range(len(points) - 1):
        start = points[index]
        end = points[index + 1]
        direction = end - start
        if direction.length <= 1e-6:
            continue
        normal = Vector((-direction.y, direction.x)).normalized() * half_width
        base = len(vertices)
        vertices.extend([
            (start.x + normal.x, start.y + normal.y),
            (start.x - normal.x, start.y - normal.y),
            (end.x + normal.x, end.y + normal.y),
            (end.x - normal.x, end.y - normal.y),
        ])
        indices.extend([(base, base + 1, base + 2), (base + 2, base + 1, base + 3)])
        if gradient:
            start_color = point_colors[index] if point_colors is not None else preview_gradient_color(index / segment_count)
            end_color = point_colors[index + 1] if point_colors is not None else preview_gradient_color((index + 1) / segment_count)
            colors.extend([start_color, start_color, end_color, end_color])

    if not vertices:
        return None
    if gradient:
        return batch_for_shader(gpu.shader.from_builtin('SMOOTH_COLOR'), 'TRIS',
                                {"pos": vertices, "color": colors}, indices=indices)
    return batch_for_shader(gpu.shader.from_builtin('UNIFORM_COLOR'), 'TRIS',
                            {"pos": vertices}, indices=indices)


def draw_path_endpoint(batch_for_shader, shader, center, radius, color):
    segments = 32
    vertices = [(center.x, center.y)]
    indices = []
    for index in range(segments):
        angle = (math.tau * index) / segments
        vertices.append((center.x + math.cos(angle) * radius, center.y + math.sin(angle) * radius))
    for index in range(1, segments + 1):
        indices.append((0, index, 1 if index == segments else index + 1))
    shader.bind()
    shader.uniform_float("color", color)
    batch = batch_for_shader(shader, 'TRIS', {"pos": vertices}, indices=indices)
    batch.draw(shader)


def draw_path_round_joins(batch_for_shader, shader, points, radius, color):
    for point in points:
        draw_path_endpoint(batch_for_shader, shader, point, radius, color)


def draw_path_gradient_joins(batch_for_shader, points, radius):
    import gpu

    if not points:
        return
    shader = gpu.shader.from_builtin('UNIFORM_COLOR')
    last_index = max(1, len(points) - 1)
    for index, point in enumerate(points):
        draw_path_endpoint(batch_for_shader, shader, point, radius, preview_gradient_color(index / last_index))


def ensure_path_gradient_overlay():
    global path_gradient_draw_handle, easy_selection_draw_handle
    if easy_selection_draw_handle is None:
        easy_selection_draw_handle = bpy.types.SpaceView3D.draw_handler_add(
            draw_easy_selection_overlay, (), 'WINDOW', 'POST_VIEW')
    if path_gradient_draw_handle is None:
        path_gradient_draw_handle = bpy.types.SpaceView3D.draw_handler_add(
            draw_palette_overlays, (), 'WINDOW', 'POST_PIXEL')


def remove_path_gradient_overlay():
    global path_gradient_draw_handle, easy_selection_draw_handle
    if easy_selection_draw_handle is not None:
        bpy.types.SpaceView3D.draw_handler_remove(easy_selection_draw_handle, 'WINDOW')
        easy_selection_draw_handle = None
    if path_gradient_draw_handle is not None:
        bpy.types.SpaceView3D.draw_handler_remove(path_gradient_draw_handle, 'WINDOW')
        path_gradient_draw_handle = None


def ensure_uv_box_overlay():
    global uv_box_draw_handle
    if uv_box_draw_handle is None:
        uv_box_draw_handle = bpy.types.SpaceImageEditor.draw_handler_add(
            draw_uv_box_selection_overlay, (), 'WINDOW', 'POST_PIXEL')


def remove_uv_box_overlay():
    global uv_box_draw_handle
    clear_uv_box_preview()
    if uv_box_draw_handle is not None:
        bpy.types.SpaceImageEditor.draw_handler_remove(
            uv_box_draw_handle, 'WINDOW')
        uv_box_draw_handle = None


def redraw_view3d_areas(context):
    screen = getattr(context, "screen", None)
    if screen is None:
        return
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.tag_redraw()


def redraw_all_areas(context):
    screen = getattr(context, "screen", None)
    if screen is None:
        return
    for area in screen.areas:
        area.tag_redraw()


def view3d_under_mouse(context, event):
    screen = getattr(context.window, "screen", None)
    if screen is None:
        return None, None, None
    for area in screen.areas:
        if area.type != 'VIEW_3D':
            continue
        if not (area.x <= event.mouse_x <= area.x + area.width and
                area.y <= event.mouse_y <= area.y + area.height):
            continue
        region = None
        for candidate in area.regions:
            if candidate.type != 'WINDOW':
                continue
            if (candidate.x <= event.mouse_x <= candidate.x + candidate.width and
                    candidate.y <= event.mouse_y <= candidate.y + candidate.height):
                region = candidate
                break
        if region is None:
            continue
        space = area.spaces.active
        rv3d = getattr(space, "region_3d", None)
        if rv3d is not None:
            return area, region, rv3d
    return None, None, None


def first_view3d(context):
    screen = getattr(context.window, "screen", None)
    if screen is None:
        return None, None, None
    for area in screen.areas:
        if area.type != 'VIEW_3D':
            continue
        region = None
        for candidate in area.regions:
            if candidate.type == 'WINDOW':
                region = candidate
                break
        if region is None:
            continue
        space = area.spaces.active
        rv3d = getattr(space, "region_3d", None)
        if rv3d is not None:
            return area, region, rv3d
    return None, None, None


def mouse_over_non_window_region(context, event):
    screen = getattr(context.window, "screen", None)
    if screen is None:
        return False
    for area in screen.areas:
        if not (area.x <= event.mouse_x <= area.x + area.width and
                area.y <= event.mouse_y <= area.y + area.height):
            continue
        for region in area.regions:
            if region.type == 'WINDOW':
                continue
            if (region.x <= event.mouse_x <= region.x + region.width and
                    region.y <= event.mouse_y <= region.y + region.height):
                return True
    return False


def mouse_over_ui_region(context, event):
    screen = getattr(context.window, "screen", None)
    if screen is None:
        return False
    ui_region_types = {'UI', 'TOOLS', 'TOOL_PROPS', 'HEADER', 'TOOL_HEADER', 'FOOTER'}
    for area in screen.areas:
        if not (area.x <= event.mouse_x <= area.x + area.width and
                area.y <= event.mouse_y <= area.y + area.height):
            continue
        for region in area.regions:
            if region.type not in ui_region_types:
                continue
            if (region.x <= event.mouse_x <= region.x + region.width and
                    region.y <= event.mouse_y <= region.y + region.height):
                return True
    return False


def mouse_over_region(region, event):
    if region is None:
        return False
    return (region.x <= event.mouse_x <= region.x + region.width and
            region.y <= event.mouse_y <= region.y + region.height)


def image_editor_window_under_mouse(context, event):
    screen = getattr(context.window, "screen", None)
    if screen is None:
        return None, None
    for area in screen.areas:
        if area.type != 'IMAGE_EDITOR':
            continue
        if not (area.x <= event.mouse_x <= area.x + area.width and
                area.y <= event.mouse_y <= area.y + area.height):
            continue
        for region in area.regions:
            if region.type != 'WINDOW':
                continue
            if (region.x <= event.mouse_x <= region.x + region.width and
                    region.y <= event.mouse_y <= region.y + region.height):
                return area, region
    return None, None


def image_editor_area_under_mouse(context, event):
    screen = getattr(context.window, "screen", None)
    if screen is None:
        return None
    for area in screen.areas:
        if area.type != 'IMAGE_EDITOR':
            continue
        if (area.x <= event.mouse_x <= area.x + area.width and
                area.y <= event.mouse_y <= area.y + area.height):
            return area
    return None


def area_region_under_mouse(area, event, region_types):
    if area is None:
        return None
    for region in area.regions:
        if region.type not in region_types:
            continue
        if (region.x <= event.mouse_x <= region.x + region.width and
                region.y <= event.mouse_y <= region.y + region.height):
            return region
    return None


def area_window_region(area):
    if area is None:
        return None
    for region in area.regions:
        if region.type == 'WINDOW':
            return region
    return None


def area_region_at_mouse(area, event):
    if area is None:
        return None
    non_window_hit = None
    window_hit = None
    for region in area.regions:
        if (region.x <= event.mouse_x <= region.x + region.width and
                region.y <= event.mouse_y <= region.y + region.height):
            if region.type == 'WINDOW':
                window_hit = region
            else:
                non_window_hit = region
    return non_window_hit or window_hit


def window_region_under_mouse(context, event, area_types):
    screen = getattr(context.window, "screen", None)
    if screen is None:
        return False
    for area in screen.areas:
        if area.type not in area_types:
            continue
        if not (area.x <= event.mouse_x <= area.x + area.width and
                area.y <= event.mouse_y <= area.y + area.height):
            continue
        for region in area.regions:
            if region.type != 'WINDOW':
                continue
            if (region.x <= event.mouse_x <= region.x + region.width and
                    region.y <= event.mouse_y <= region.y + region.height):
                return True
    return False


def primary_modifier(event):
    """Ctrl on Windows/Linux, with Command accepted as its macOS equivalent."""
    return bool(getattr(event, "ctrl", False) or getattr(event, "oskey", False))


def alt_modifier_active(event, held=False):
    """Track Alt/Option even when Blender remaps Option+LMB mouse events."""
    return bool(getattr(event, "alt", False) or held)


def uv_cell_mouse_event(event, alt_held=False):
    """Accept LMB and macOS-emulated Option+LMB without stealing real Alt+MMB."""
    if event.type == 'LEFTMOUSE':
        return True
    return bool(
        event.type == 'MIDDLEMOUSE' and alt_held and
        not getattr(event, "alt", False))


def run_uv_box_select(context, area, region, space, start, end, mode='SET'):
    """Run Blender's native UV box selection with region-local coordinates."""
    xmin = int(min(start.x, end.x))
    xmax = int(max(start.x, end.x))
    ymin = int(min(start.y, end.y))
    ymax = int(max(start.y, end.y))
    if xmax <= xmin or ymax <= ymin:
        return False

    override_args = {
        "window": context.window,
        "area": area,
        "region": region,
        "space_data": space,
    }
    try:
        with context.temp_override(**override_args):
            result = bpy.ops.uv.select_box(
                'EXEC_DEFAULT', xmin=xmin, xmax=xmax, ymin=ymin, ymax=ymax,
                wait_for_input=False, mode=mode)
    except (RuntimeError, TypeError):
        return False
    return 'FINISHED' in result


def run_uv_cell_select(context, area, region, space, cell_x, cell_y_top,
                       grid_cell_width_uv, grid_cell_height_uv, mode='SET'):
    """Select UVs inside one palette cell using Blender's native selector."""
    view2d = getattr(region, "view2d", None)
    if view2d is None:
        return False
    min_u = cell_x * grid_cell_width_uv
    max_u = min_u + grid_cell_width_uv
    min_v = 1.0 - ((cell_y_top + 1) * grid_cell_height_uv)
    max_v = min_v + grid_cell_height_uv
    start = view2d.view_to_region(min_u, min_v, clip=False)
    end = view2d.view_to_region(max_u, max_v, clip=False)
    if start is None or end is None:
        return False
    return run_uv_box_select(
        context, area, region, space, Vector(start), Vector(end), mode=mode)


def uv_to_cell_index_top(uv, grid_cell_width_uv, grid_cell_height_uv):
    """
    Возвращает (ix, iy_top) — индекс ячейки по X (слева направо) и по Y,
    где iy_top=0 — верхняя строка (top-left origin).
    """
    ix = int(math.floor(uv.x / grid_cell_width_uv))
    iy_top = int(math.floor((1.0 - uv.y) / grid_cell_height_uv))
    return ix, iy_top


def is_already_snapped(uv_coords, grid_cell_width_uv, grid_cell_height_uv):
    """
    Проверяет, лежат ли все UV координаты в одной и той же ячейке,
    используя индексацию строк от верха (top-left).
    Возвращает (True, (cell_index_x, cell_index_y_top)) или (False, None).
    """
    if not uv_coords:
        return False, None
    min_u = min(uv.x for uv in uv_coords)
    max_u = max(uv.x for uv in uv_coords)
    min_v = min(uv.y for uv in uv_coords)
    max_v = max(uv.y for uv in uv_coords)
    center = Vector(((min_u + max_u) * 0.5, (min_v + max_v) * 0.5))
    cell_x, cell_y_top = uv_to_cell_index_top(
        center, grid_cell_width_uv, grid_cell_height_uv)
    cell_min_u = cell_x * grid_cell_width_uv
    cell_max_u = cell_min_u + grid_cell_width_uv
    cell_min_v = 1.0 - ((cell_y_top + 1) * grid_cell_height_uv)
    cell_max_v = cell_min_v + grid_cell_height_uv
    tolerance = max(grid_cell_width_uv, grid_cell_height_uv) * 1e-9
    if (min_u < cell_min_u - tolerance or max_u > cell_max_u + tolerance or
            min_v < cell_min_v - tolerance or max_v > cell_max_v + tolerance):
        return False, None
    return True, (cell_x, cell_y_top)


def loop_uv_selected(loop, uv_layer, tool_settings=None):
    """Return True if this UV loop/corner is selected.

    Prefer per-corner UV selection from UV loop data when available.
    This avoids pulling extra loops through shared mesh verts, which can
    distort bounds/scaling on some Blender versions.
    """
    if tool_settings is not None and tool_settings.use_uv_select_sync:
        # In UV Sync mode, trust mesh selection only.
        if loop.face.hide:
            return False
        sel_mode = tool_settings.mesh_select_mode
        if sel_mode[2]:
            return bool(loop.face.select and not loop.face.hide)
        if sel_mode[1]:
            current_edge_selected = loop.edge.select and not loop.edge.hide
            previous_edge = loop.link_loop_prev.edge
            previous_edge_selected = previous_edge.select and not previous_edge.hide
            return bool(current_edge_selected or previous_edge_selected)
        return bool(loop.vert.select and not loop.vert.hide and not loop.face.hide)

    uv_data = loop[uv_layer]
    vertex_selected = any(bool(getattr(uv_data, attr, False))
                          for attr in ("select", "select_vert"))
    edge_selected = bool(getattr(uv_data, "select_edge", False))
    previous_uv_data = loop.link_loop_prev[uv_layer]
    edge_selected = edge_selected or bool(getattr(previous_uv_data, "select_edge", False))
    # Compatibility fallback for APIs exposing UV selection on BMLoop.
    vertex_selected = vertex_selected or any(
        bool(getattr(loop, attr, False)) for attr in ("uv_select", "uv_select_vert"))
    edge_selected = edge_selected or bool(getattr(loop, "uv_select_edge", False))
    edge_selected = edge_selected or bool(
        getattr(loop.link_loop_prev, "uv_select_edge", False))
    return vertex_selected or edge_selected


def uv_edges_connected(loop_a, loop_b, uv_layer, threshold=1e-6):
    """Return whether two loops represent the same non-seam UV edge."""
    a_start = loop_a[uv_layer].uv
    a_end = loop_a.link_loop_next[uv_layer].uv
    b_start = loop_b[uv_layer].uv
    b_end = loop_b.link_loop_next[uv_layer].uv
    return (((a_start - b_end).length <= threshold and
             (a_end - b_start).length <= threshold) or
            ((a_start - b_start).length <= threshold and
             (a_end - b_end).length <= threshold))


def get_selected_uv_islands(bm, uv_layer, tool_settings=None, threshold=1e-6):
    """Group selected UV loops by real mesh-edge and UV continuity.

    Coincident but topologically unrelated UVs stay in separate islands, while
    a seam on a shared mesh edge splits the groups as expected.
    """
    visible_faces = [face for face in bm.faces if not face.hide]
    all_loops = [loop for face in visible_faces for loop in face.loops]
    adjacency = {loop: set() for loop in all_loops}
    edge_loops = {}

    for face in visible_faces:
        for loop in face.loops:
            next_loop = loop.link_loop_next
            adjacency[loop].add(next_loop)
            adjacency[next_loop].add(loop)
            edge_loops.setdefault(loop.edge, []).append(loop)

    for loops in edge_loops.values():
        for index, loop_a in enumerate(loops):
            for loop_b in loops[index + 1:]:
                if uv_edges_connected(loop_a, loop_b, uv_layer, threshold):
                    adjacency[loop_a].add(loop_b)
                    adjacency[loop_b].add(loop_a)

    selected = {loop for loop in all_loops
                if loop_uv_selected(loop, uv_layer, tool_settings)}
    islands = []
    visited = set()
    for start in all_loops:
        if start in visited:
            continue
        component = set()
        stack = [start]
        while stack:
            loop = stack.pop()
            if loop in visited:
                continue
            visited.add(loop)
            component.add(loop)
            stack.extend(adjacency[loop] - visited)
        selected_component = component & selected
        if selected_component:
            islands.append(list(selected_component))
    return islands


def serialize_path_points(points):
    return ";".join("{:.9g},{:.9g},{:.9g}".format(p.x, p.y, p.z) for p in points)


def serialize_screen_points(points):
    return ";".join("{:.3f},{:.3f}".format(p.x, p.y) for p in points)


def serialize_gradient_colors(colors):
    return ";".join("{:.6f},{:.6f},{:.6f},{:.6f}".format(c[0], c[1], c[2], c[3]) for c in colors)


def deserialize_gradient_colors(value):
    colors = []
    if not value:
        return colors
    for chunk in value.split(";"):
        values = chunk.split(",")
        if len(values) != 4:
            continue
        try:
            colors.append(tuple(float(v) for v in values))
        except ValueError:
            continue
    return colors


def pixel_color(pixels, width, height, x, y):
    x = max(0, min(width - 1, int(round(x))))
    y = max(0, min(height - 1, int(round(y))))
    pixel_index = (y * width + x) * 4
    return (pixels[pixel_index], pixels[pixel_index + 1],
            pixels[pixel_index + 2], pixels[pixel_index + 3])


def averaged_pixel_color(pixels, width, height, x, y, horizontal_gradient):
    offsets = (-2, -1, 0, 1, 2)
    color = Vector((0.0, 0.0, 0.0, 0.0))
    for offset in offsets:
        if horizontal_gradient:
            sample = pixel_color(pixels, width, height, x, y + offset)
        else:
            sample = pixel_color(pixels, width, height, x + offset, y)
        color += Vector(sample)
    color /= len(offsets)
    return (color.x, color.y, color.z, color.w)


def sample_palette_gradient(image, cell_x, cell_y_top, cell_width_px, cell_height_px, direction, sample_count=None):
    if image is None or image.size[0] <= 0 or image.size[1] <= 0:
        return []
    width, height = image.size
    pixels = array('f', [0.0]) * (width * height * 4)
    image.pixels.foreach_get(pixels)
    colors = []
    cell_left = cell_x * cell_width_px
    cell_top = cell_y_top * cell_height_px
    horizontal_gradient = direction in {'LEFT_TO_RIGHT', 'RIGHT_TO_LEFT'}
    if sample_count is None:
        sample_axis_size = cell_width_px if horizontal_gradient else cell_height_px
        sample_count = max(8, min(128, int(sample_axis_size)))

    for index in range(sample_count):
        factor = index / max(1, sample_count - 1)
        if direction == 'RIGHT_TO_LEFT':
            px = cell_left + int(round((1.0 - factor) * (cell_width_px - 1)))
            py = height - 1 - (cell_top + cell_height_px // 2)
        elif direction == 'BOTTOM_TO_TOP':
            px = cell_left + cell_width_px // 2
            py = height - 1 - (cell_top + int(round((1.0 - factor) * (cell_height_px - 1))))
        elif direction == 'TOP_TO_BOTTOM':
            px = cell_left + cell_width_px // 2
            py = height - 1 - (cell_top + int(round(factor * (cell_height_px - 1))))
        else:
            px = cell_left + int(round(factor * (cell_width_px - 1)))
            py = height - 1 - (cell_top + cell_height_px // 2)

        colors.append(averaged_pixel_color(pixels, width, height, px, py, horizontal_gradient))
    return colors


def deserialize_screen_points(value):
    points = []
    if not value:
        return points
    for chunk in value.split(";"):
        coords = chunk.split(",")
        if len(coords) != 2:
            continue
        try:
            points.append(Vector((float(coords[0]), float(coords[1]))))
        except ValueError:
            continue
    return points


def deserialize_path_points(value):
    points = []
    if not value:
        return points
    for chunk in value.split(";"):
        coords = chunk.split(",")
        if len(coords) != 3:
            continue
        try:
            points.append(Vector((float(coords[0]), float(coords[1]), float(coords[2]))))
        except ValueError:
            continue
    return points


def closest_path_progress(point, path_points):
    """Return progress along path [0..1] and distance from the nearest path segment."""
    if len(path_points) < 2:
        return 0.0, 0.0

    segment_lengths = []
    total_length = 0.0
    for index in range(len(path_points) - 1):
        length = (path_points[index + 1] - path_points[index]).length
        segment_lengths.append(length)
        total_length += length

    if total_length <= 1e-12:
        return 0.0, (point - path_points[0]).length

    best_distance = None
    best_progress = 0.0
    walked = 0.0
    for index, length in enumerate(segment_lengths):
        start = path_points[index]
        end = path_points[index + 1]
        segment = end - start
        if length <= 1e-12:
            continue
        factor = max(0.0, min(1.0, (point - start).dot(segment) / segment.dot(segment)))
        nearest = start + segment * factor
        distance = (point - nearest).length
        if best_distance is None or distance < best_distance:
            best_distance = distance
            best_progress = (walked + length * factor) / total_length
        walked += length

    return best_progress, best_distance if best_distance is not None else 0.0


def selected_loop_data(bm, uv_layer, tool_settings):
    loops_data = []
    for face in bm.faces:
        if face.hide:
            continue
        for loop in face.loops:
            if loop_uv_selected(loop, uv_layer, tool_settings):
                loops_data.append((loop, loop[uv_layer].uv.copy()))
    return loops_data


def selected_face_loop_data(bm, uv_layer, tool_settings):
    face_loops = []
    for face in bm.faces:
        if face.hide or not face.select:
            continue
        for loop in face.loops:
            face_loops.append((loop, loop[uv_layer].uv.copy()))
    if face_loops:
        return face_loops
    return selected_loop_data(bm, uv_layer, tool_settings)


def loops_selection_signature(loops_data):
    signature = []
    for loop, _uv in loops_data:
        signature.append((loop.face.index, loop.vert.index))
    return tuple(sorted(signature))


def apply_path_gradient_uvs(loops_data, obj, uv_layer, path_points, target_min_u, target_min_v,
                            effective_cell_width_uv, effective_cell_height_uv, direction):
    if not loops_data:
        return

    world_matrix = obj.matrix_world
    samples = []
    for loop, _uv_orig in loops_data:
        world_point = world_matrix @ loop.vert.co
        progress, _distance = closest_path_progress(world_point, path_points)
        samples.append((loop, progress))

    center_v = target_min_v + effective_cell_height_uv * 0.5
    center_u = target_min_u + effective_cell_width_uv * 0.5

    for loop, progress in samples:
        if direction == 'RIGHT_TO_LEFT':
            loop[uv_layer].uv = Vector((target_min_u + (1.0 - progress) * effective_cell_width_uv, center_v))
        elif direction == 'BOTTOM_TO_TOP':
            loop[uv_layer].uv = Vector((center_u, target_min_v + progress * effective_cell_height_uv))
        elif direction == 'TOP_TO_BOTTOM':
            loop[uv_layer].uv = Vector((center_u, target_min_v + (1.0 - progress) * effective_cell_height_uv))
        else:
            loop[uv_layer].uv = Vector((target_min_u + progress * effective_cell_width_uv, center_v))


def gradient_projected_vertices(loops_data, obj, region, rv3d):
    """Project each selected vertex once, keeping all of its UV corners."""
    groups = {}
    for loop, _ in loops_data:
        groups.setdefault(loop.vert, []).append(loop)
    points, corners = [], []
    matrix = obj.matrix_world
    for vert, loops in groups.items():
        point = view3d_utils.location_3d_to_region_2d(region, rv3d, matrix @ vert.co)
        if point is not None:
            points.append((point.x, point.y))
            corners.append(loops)
    return np.asarray(points, dtype=np.float64).reshape((-1, 2)), corners


def gradient_screen_progress(points, path):
    """Nearest-segment progress, vectorized in bounded blocks for dense meshes."""
    path = np.asarray(path, dtype=np.float64)
    starts = path[:-1]
    delta = path[1:] - starts
    squared = np.sum(delta * delta, axis=1)
    lengths = np.sqrt(squared)
    offsets = np.cumsum(lengths) - lengths
    total = lengths.sum()
    if total <= 1e-12:
        return np.zeros(len(points), dtype=np.float64)
    valid = squared > 1e-24
    starts, delta = starts[valid], delta[valid]
    squared, lengths, offsets = squared[valid], lengths[valid], offsets[valid]
    result = np.empty(len(points), dtype=np.float64)
    # Bound the temporary vertex x segment matrices, including long freehand paths.
    block_size = max(1, min(1024, 131072 // max(1, len(starts))))
    for start in range(0, len(points), block_size):
        block = points[start:start+block_size]
        dx = block[:, None, 0] - starts[None, :, 0]
        dy = block[:, None, 1] - starts[None, :, 1]
        t = np.clip((dx*delta[:, 0] + dy*delta[:, 1]) / squared, 0.0, 1.0)
        dx -= t*delta[:, 0]
        dy -= t*delta[:, 1]
        nearest = np.argmin(dx*dx + dy*dy, axis=1)
        rows = np.arange(len(block))
        result[start:start+len(block)] = (offsets[nearest] + t[rows, nearest]*lengths[nearest]) / total
    return result


def closed_face_progress(values):
    """Keep a seam-crossing face on one end of the palette, without changing topology."""
    if len(values) < 2 or max(values)-min(values) <= 0.5:
        return values
    ordered = sorted(value % 1.0 for value in values)
    gaps = [ordered[i+1]-ordered[i] for i in range(len(ordered)-1)]
    gaps.append(ordered[0]+1.0-ordered[-1])
    gap = max(range(len(gaps)), key=gaps.__getitem__)
    if gap == len(ordered)-1:
        return values
    start = ordered[gap+1]
    unwrapped = [value % 1.0 + (1.0 if value % 1.0 < start else 0.0) for value in values]
    # Choose the side that clips the least. Clipping stays inside the palette
    # cell; unrestricted UV wrapping would sample neighboring cells instead.
    high_cost = sum(max(0.0, value-1.0)**2 for value in unwrapped)
    low_cost = sum(min(0.0, value-1.0)**2 for value in unwrapped)
    shift = 0.0 if high_cost <= low_cost else 1.0
    return [max(0.0, min(1.0, value-shift)) for value in unwrapped]


def apply_path_gradient_screen_uvs(loops_data, obj, uv_layer, screen_points, region, rv3d,
                                   target_min_u, target_min_v, effective_cell_width_uv,
                                   effective_cell_height_uv, direction, projected=None, closed=False):
    if not loops_data or len(screen_points) < 2:
        return
    points, corners = projected if projected is not None else gradient_projected_vertices(
        loops_data, obj, region, rv3d)
    values = gradient_screen_progress(points, screen_points)
    if closed:
        # UV corners on adjacent faces may intentionally differ at the seam.
        faces = {}
        for progress, loops in zip(values, corners):
            for loop in loops:
                faces.setdefault(loop.face, []).append((loop, float(progress)))
        for face, samples in faces.items():
            progress = [value for _loop, value in samples]
            # A partial face selection must not alter its unselected corners.
            if len(samples) == len(face.loops):
                progress = closed_face_progress(progress)
            for (loop, _old), value in zip(samples, progress):
                set_loop_gradient_uv(loop, uv_layer, value, target_min_u, target_min_v,
                                     effective_cell_width_uv, effective_cell_height_uv, direction)
        return
    center_v = target_min_v + effective_cell_height_uv * 0.5
    center_u = target_min_u + effective_cell_width_uv * 0.5
    for progress, loops in zip(values, corners):
        if direction in {'RIGHT_TO_LEFT', 'TOP_TO_BOTTOM'}:
            progress = 1.0-progress
        if direction in {'BOTTOM_TO_TOP', 'TOP_TO_BOTTOM'}:
            uv = (center_u, target_min_v + float(progress)*effective_cell_height_uv)
        else:
            uv = (target_min_u + float(progress)*effective_cell_width_uv, center_v)
        for loop in loops:
            loop[uv_layer].uv = uv


def safe_gradient_bounds(target_min_u, target_min_v,
                         effective_cell_width_uv, effective_cell_height_uv,
                         margin_x_uv, margin_y_uv, texture_width, texture_height):
    """Keep gradient endpoints at pixel centers when a cell has no margin.

    UVs exactly on a palette-cell border can blend with the neighboring cell
    under linear texture filtering. Existing user margins take precedence;
    only the missing part of a half-texel inset is added.
    """
    half_texel_u = 0.5 / max(1, texture_width)
    half_texel_v = 0.5 / max(1, texture_height)
    inset_u = min(
        max(0.0, half_texel_u - margin_x_uv),
        effective_cell_width_uv * 0.5)
    inset_v = min(
        max(0.0, half_texel_v - margin_y_uv),
        effective_cell_height_uv * 0.5)
    return (
        target_min_u + inset_u,
        target_min_v + inset_v,
        max(0.0, effective_cell_width_uv - 2.0 * inset_u),
        max(0.0, effective_cell_height_uv - 2.0 * inset_v),
    )


def set_loop_gradient_uv(loop, uv_layer, progress, target_min_u, target_min_v,
                         effective_cell_width_uv, effective_cell_height_uv, direction):
    center_v = target_min_v + effective_cell_height_uv * 0.5
    center_u = target_min_u + effective_cell_width_uv * 0.5
    progress = max(0.0, min(1.0, progress))
    if direction == 'RIGHT_TO_LEFT':
        loop[uv_layer].uv = Vector((target_min_u + (1.0 - progress) * effective_cell_width_uv, center_v))
    elif direction == 'BOTTOM_TO_TOP':
        loop[uv_layer].uv = Vector((center_u, target_min_v + progress * effective_cell_height_uv))
    elif direction == 'TOP_TO_BOTTOM':
        loop[uv_layer].uv = Vector((center_u, target_min_v + (1.0 - progress) * effective_cell_height_uv))
    else:
        loop[uv_layer].uv = Vector((target_min_u + progress * effective_cell_width_uv, center_v))


def apply_distance_gradient_uvs(loops_data, obj, uv_layer, source_location,
                                target_min_u, target_min_v, effective_cell_width_uv,
                                effective_cell_height_uv, direction):
    if not loops_data:
        return False

    world_matrix = obj.matrix_world
    samples = []
    for loop, _uv_orig in loops_data:
        distance = (world_matrix @ loop.vert.co - source_location).length
        samples.append((loop, distance))
    min_distance = min(distance for _loop, distance in samples)
    max_distance = max(distance for _loop, distance in samples)
    distance_span = max_distance - min_distance
    for loop, distance in samples:
        progress = 0.0 if distance_span <= 1e-12 else (distance - min_distance) / distance_span
        set_loop_gradient_uv(loop, uv_layer, progress, target_min_u, target_min_v,
                             effective_cell_width_uv, effective_cell_height_uv, direction)
    return True


def loops_world_center(loops_data, obj):
    if not loops_data:
        return None
    world_matrix = obj.matrix_world
    unique_verts = {}
    for loop, _uv_orig in loops_data:
        unique_verts[loop.vert.index] = loop.vert
    if not unique_verts:
        return None
    center = Vector((0.0, 0.0, 0.0))
    for vert in unique_verts.values():
        center += world_matrix @ vert.co
    return center / len(unique_verts)


def edge_signed_angle(edge):
    try:
        return edge.calc_face_angle_signed(0.0)
    except Exception:
        try:
            return edge.calc_face_angle(0.0)
        except Exception:
            return 0.0


def selected_loop_vertices(loops_data):
    return {loop.vert for loop, _uv_orig in loops_data}


def smooth_vertex_scores(scores, neighbors, iterations):
    current = dict(scores)
    for _index in range(max(0, iterations)):
        next_scores = {}
        for vert, score in current.items():
            linked = [current[other] for other in neighbors.get(vert, ()) if other in current]
            if linked:
                next_scores[vert] = (score + sum(linked)) / (len(linked) + 1)
            else:
                next_scores[vert] = score
        current = next_scores
    return current


def strongest_signed_value(current, candidate):
    if abs(candidate) > abs(current):
        return candidate
    return current


def edge_falloff_scores(source_scores, neighbors, rings):
    if not source_scores:
        return {}
    result = dict(source_scores)
    frontier = dict(source_scores)
    visited = set(source_scores.keys())
    for ring in range(max(0, rings)):
        decay = 1.0 - ((ring + 1) / (rings + 1))
        next_frontier = {}
        for vert, value in frontier.items():
            for other in neighbors.get(vert, ()):
                if other in visited:
                    continue
                propagated = value * decay
                next_frontier[other] = strongest_signed_value(next_frontier.get(other, 0.0), propagated)
                result[other] = strongest_signed_value(result.get(other, 0.0), propagated)
        visited.update(next_frontier.keys())
        frontier = next_frontier
        if not frontier:
            break
    return result


def cavity_vertex_scores(loops_data, scene):
    verts = selected_loop_vertices(loops_data)
    if not verts:
        return {}

    cavity_strength = scene.snap_uv_cavity_strength
    edge_strength = scene.snap_uv_edge_strength
    edge_falloff = scene.snap_uv_edge_falloff
    threshold = math.radians(scene.snap_uv_edge_threshold)
    contrast = scene.snap_uv_cavity_contrast
    bias = scene.snap_uv_cavity_bias

    signed_accum = {vert: [] for vert in verts}
    edge_source = {}
    neighbors = {vert: set() for vert in verts}
    seen_edges = set()

    for vert in verts:
        for edge in vert.link_edges:
            if edge in seen_edges:
                continue
            linked_verts = [v for v in edge.verts if v in verts]
            if len(linked_verts) == 2:
                neighbors[linked_verts[0]].add(linked_verts[1])
                neighbors[linked_verts[1]].add(linked_verts[0])
            if len(edge.link_faces) < 2:
                continue
            seen_edges.add(edge)
            angle = edge_signed_angle(edge)
            signed = max(-1.0, min(1.0, angle / math.pi))
            edge_factor = 0.0
            abs_angle = abs(angle)
            if abs_angle > threshold:
                edge_factor = min(1.0, (abs_angle - threshold) / max(1e-6, math.pi - threshold))

            for edge_vert in edge.verts:
                if edge_vert not in verts:
                    continue
                signed_accum[edge_vert].append(signed)
                if edge_factor > 0.0:
                    edge_source[edge_vert] = strongest_signed_value(
                        edge_source.get(edge_vert, 0.0), signed * edge_factor)

    edge_scores = edge_falloff_scores(edge_source, neighbors, edge_falloff)

    scores = {}
    for vert in verts:
        signed_value = sum(signed_accum[vert]) / len(signed_accum[vert]) if signed_accum[vert] else 0.0
        edge_value = edge_scores.get(vert, 0.0)
        if scene.snap_uv_cavity_invert:
            signed_value = -signed_value
            edge_value = -edge_value
        value = 0.5 + signed_value * cavity_strength * 0.5 + edge_value * edge_strength * 0.5
        value = (value - 0.5) * contrast + 0.5 + bias
        scores[vert] = max(0.0, min(1.0, value))

    return smooth_vertex_scores(scores, neighbors, scene.snap_uv_cavity_smooth)


def apply_cavity_gradient_uvs(loops_data, obj, uv_layer, target_min_u, target_min_v,
                              effective_cell_width_uv, effective_cell_height_uv, direction, scene):
    if not loops_data:
        return False
    scores = cavity_vertex_scores(loops_data, scene)
    if not scores:
        return False
    for loop, _uv_orig in loops_data:
        progress = scores.get(loop.vert, 0.5)
        set_loop_gradient_uv(loop, uv_layer, progress, target_min_u, target_min_v,
                             effective_cell_width_uv, effective_cell_height_uv, direction)
    return True


def fit_loops_to_cell(loops_data, uv_layer, target_min_u, target_min_v,
                      effective_cell_width_uv, effective_cell_height_uv,
                      grid_cell_width_uv, grid_cell_height_uv, margin_x_uv,
                      margin_y_uv, preserve_value):
    if not loops_data:
        return

    uv_coords = [uv.copy() for _loop, uv in loops_data]
    snapped, old_cell = is_already_snapped(uv_coords, grid_cell_width_uv, grid_cell_height_uv) if preserve_value else (False, None)
    if snapped:
        old_cell_x, old_cell_y_top = old_cell
        old_effective_min = Vector((
            old_cell_x * grid_cell_width_uv + margin_x_uv,
            1.0 - ((old_cell_y_top + 1) * grid_cell_height_uv) + margin_y_uv))
        for loop, uv_orig in loops_data:
            rel_x = ((uv_orig.x - old_effective_min.x) / effective_cell_width_uv
                     if effective_cell_width_uv != 0 else 0)
            rel_y = ((uv_orig.y - old_effective_min.y) / effective_cell_height_uv
                     if effective_cell_height_uv != 0 else 0)
            loop[uv_layer].uv = Vector((
                target_min_u + rel_x * effective_cell_width_uv,
                target_min_v + rel_y * effective_cell_height_uv))
        return

    min_uv = Vector((min(uv.x for uv in uv_coords), min(uv.y for uv in uv_coords)))
    max_uv = Vector((max(uv.x for uv in uv_coords), max(uv.y for uv in uv_coords)))
    bbox_width = max_uv.x - min_uv.x
    bbox_height = max_uv.y - min_uv.y
    center = Vector((
        target_min_u + effective_cell_width_uv * 0.5,
        target_min_v + effective_cell_height_uv * 0.5))
    if bbox_width == 0 and bbox_height == 0:
        for loop, _uv_orig in loops_data:
            loop[uv_layer].uv = center
        return

    scale_x = effective_cell_width_uv / bbox_width if bbox_width > 1e-12 else 0.0
    scale_y = effective_cell_height_uv / bbox_height if bbox_height > 1e-12 else 0.0
    for loop, uv_orig in loops_data:
        new_u = (center.x if bbox_width <= 1e-12
                 else target_min_u + (uv_orig.x - min_uv.x) * scale_x)
        new_v = (center.y if bbox_height <= 1e-12
                 else target_min_v + (uv_orig.y - min_uv.y) * scale_y)
        loop[uv_layer].uv = Vector((
            new_u,
            new_v))


def uv_coords_degenerate(loops_data):
    if not loops_data:
        return True
    uv_coords = [uv for _loop, uv in loops_data]
    min_u = min(uv.x for uv in uv_coords)
    max_u = max(uv.x for uv in uv_coords)
    min_v = min(uv.y for uv in uv_coords)
    max_v = max(uv.y for uv in uv_coords)
    return (max_u - min_u) <= 1e-8 or (max_v - min_v) <= 1e-8


def project_loops_from_view(loops_data, obj, uv_layer, region, rv3d):
    if not loops_data or region is None or rv3d is None:
        return False

    world_matrix = obj.matrix_world
    projected = []
    for loop, _uv_orig in loops_data:
        screen_point = view3d_utils.location_3d_to_region_2d(region, rv3d, world_matrix @ loop.vert.co)
        if screen_point is not None:
            projected.append((loop, screen_point))

    # Avoid mixing freshly projected and stale UVs when a point cannot be
    # represented in the current view.
    if len(projected) != len(loops_data) or len(projected) < 2:
        return False

    min_x = min(point.x for _loop, point in projected)
    max_x = max(point.x for _loop, point in projected)
    min_y = min(point.y for _loop, point in projected)
    max_y = max(point.y for _loop, point in projected)
    width = max_x - min_x
    height = max_y - min_y
    if width <= 1e-8 and height <= 1e-8:
        return False

    for loop, point in projected:
        projected_u = 0.5 if width <= 1e-8 else (point.x - min_x) / width
        projected_v = 0.5 if height <= 1e-8 else (point.y - min_y) / height
        loop[uv_layer].uv = Vector((projected_u, projected_v))
    return True

# --- Scene properties ---

def init_properties():
    sc = bpy.types.Scene
    sc.snap_uv_texture_width = bpy.props.IntProperty(
        name="Texture Width", default=1024, min=1,
        description="Texture width in pixels")
    sc.snap_uv_texture_height = bpy.props.IntProperty(
        name="Texture Height", default=1024, min=1,
        description="Texture height in pixels")
    sc.snap_uv_cell_width = bpy.props.IntProperty(
        name="Cell Width", default=64, min=1,
        description="Cell width in pixels")
    sc.snap_uv_cell_height = bpy.props.IntProperty(
        name="Cell Height", default=64, min=1,
        description="Cell height in pixels")
    # Margins now as fraction (0.0 to 0.5) of the cell size
    sc.snap_uv_margin_x = bpy.props.FloatProperty(
        name="Margin X (%)", default=0.0, min=0.0, max=0.5,
        description="Horizontal margin as a fraction of the cell width (0.0 to 0.5)")
    sc.snap_uv_margin_y = bpy.props.FloatProperty(
        name="Margin Y (%)", default=0.0, min=0.0, max=0.5,
        description="Vertical margin as a fraction of the cell height (0.0 to 0.5)")
    # Additional options:
    sc.snap_uv_preserve = bpy.props.BoolProperty(
        name="Preserve Previous Fitting", default=False,
        description="If enabled, if the selected UVs (or islands) are already snapped to a cell, "
                    "their relative position and scale relative to that cell are preserved when moving to a new cell.")
    sc.snap_uv_independent = bpy.props.BoolProperty(
        name="Independent Islands", default=False,
        description="If enabled, process each UV island independently. When the mesh is split (via Mesh → Split → Selection), "
                    "the loose parts are treated as separate islands.")
    sc.snap_uv_path_points = bpy.props.StringProperty(
        name="Path Points", default="",
        description="Internal storage for the last path drawn on the active mesh.")
    sc.snap_uv_path_screen_points = bpy.props.StringProperty(
        name="Path Screen Points", default="",
        description="Internal storage for the drawn viewport stroke.")
    sc.snap_uv_path_debug = bpy.props.StringProperty(
        name="Path Debug", default="",
        description="Internal debug info for path drawing.")
    sc.snap_uv_path_colors = bpy.props.StringProperty(
        name="Path Colors", default="",
        description="Internal sampled colors for the path gradient preview.")
    sc.snap_uv_controls_expanded = bpy.props.BoolProperty(
        name="Controls", default=False,
        description="Show painting shortcuts and interaction hints")
    sc.snap_uv_cavity_expanded = bpy.props.BoolProperty(
        name="Cavity / Fake AO", default=False,
        description="Show cavity and fake ambient occlusion settings")
    sc.snap_uv_easy_mode = bpy.props.BoolProperty(
        name="Easy Mode", default=False,
        description="Click a seam-delimited piece to project or move it to the active cell. Draw gradients to automatically pick whole pieces")
    sc.snap_uv_easy_variant = bpy.props.EnumProperty(
        name="Workflow", default='AUTO',
        items=[('AUTO', "Automatic", "Click to paint; gradients automatically target pieces"),
               ('SELECT', "Select Then Paint", "Brush-select pieces; Enter/Space paints the active cell, Tab+LMB draws a gradient on the set")])
    sc.snap_uv_easy_drag_gradient = bpy.props.BoolProperty(
        name="Drag to Draw Gradient", default=False,
        description="Click to paint, drag to draw a gradient. In Select Then Paint, confirm the selection first. Click applies on release")
    sc.snap_uv_easy_through = bpy.props.BoolProperty(
        name="Include Occluded Pieces", default=False,
        description="Also paint separate pieces behind the front surface under a gradient. Hidden geometry is always excluded")
    sc.snap_uv_gradient_snap = bpy.props.BoolProperty(
        name="Snap Gradient Points", default=False,
        description="Snap to visible vertices and midpoints within 14 pixels, or to the face surface under the cursor. F8 toggles while painting")
    sc.snap_uv_show_gradients = bpy.props.BoolProperty(
        name="Show Gradient Handles", default=True,
        description="Show and edit saved gradients on the selection while painting. Projection and fitting do not create gradient handles")
    sc.snap_uv_path_style = bpy.props.EnumProperty(
        name="Path Style",
        default='FREEHAND',
        items=[
            ('FREEHAND', "Freehand", "Draw a freehand path in the 3D View"),
            ('STRAIGHT', "Straight", "Draw a straight gradient line from press to release"),
            ('BEZIER', "Bezier", "Hold Tab and click to add points; drag to shape handles; release Tab to finish"),
            ('CIRCLE', "Circle", "Tab+drag draws a circle; drag its two axis handles independently to make an ellipse"),
        ],
        description="How Tab+Left Mouse draws path gradients.")
    sc.snap_uv_gradient_direction = bpy.props.EnumProperty(
        name="Gradient Direction",
        default='TOP_TO_BOTTOM',
        items=[
            ('LEFT_TO_RIGHT', "Left to Right", "Map path start to the left side of the selected palette cell"),
            ('RIGHT_TO_LEFT', "Right to Left", "Map path start to the right side of the selected palette cell"),
            ('BOTTOM_TO_TOP', "Bottom to Top", "Map path start to the bottom side of the selected palette cell"),
            ('TOP_TO_BOTTOM', "Top to Bottom", "Map path start to the top side of the selected palette cell"),
        ],
        description="Direction used when mapping the drawn path into the selected palette gradient cell.")
    sc.snap_uv_path_stabilizer = bpy.props.FloatProperty(
        name="Path Stabilizer",
        default=0.55,
        min=0.0,
        max=0.95,
        subtype='FACTOR',
        description="Smooths freehand path drawing. Higher values add more cursor stabilization.")
    sc.snap_uv_cavity_strength = bpy.props.FloatProperty(
        name="Cavity Strength",
        default=1.0,
        min=0.0,
        max=3.0,
        description="Overall curvature strength. Higher values push concave/convex areas farther across the palette gradient.")
    sc.snap_uv_edge_strength = bpy.props.FloatProperty(
        name="Edge Strength",
        default=0.35,
        min=0.0,
        max=3.0,
        description="Extra light/dark accent generated directly from sharp edges.")
    sc.snap_uv_edge_threshold = bpy.props.FloatProperty(
        name="Edge Threshold",
        default=25.0,
        min=0.0,
        max=180.0,
        description="Minimum angle before an edge gets the edge accent. Lower catches more edges.")
    sc.snap_uv_edge_falloff = bpy.props.IntProperty(
        name="Edge Falloff",
        default=1,
        min=0,
        max=12,
        description="Width of the edge accent in selected vertex rings. 0 affects only vertices on the edge.")
    sc.snap_uv_cavity_smooth = bpy.props.IntProperty(
        name="Cavity Smooth",
        default=1,
        min=0,
        max=8,
        description="Blurs cavity values across connected selected vertices. Lower values keep accents tighter.")
    sc.snap_uv_cavity_contrast = bpy.props.FloatProperty(
        name="Cavity Contrast",
        default=1.0,
        min=0.1,
        max=4.0,
        description="Makes cavity values more or less punchy before palette mapping.")
    sc.snap_uv_cavity_bias = bpy.props.FloatProperty(
        name="Cavity Bias",
        default=0.0,
        min=-1.0,
        max=1.0,
        description="Shifts the result toward the dark or light side of the palette cell.")
    sc.snap_uv_cavity_invert = bpy.props.BoolProperty(
        name="Invert Cavity",
        default=False,
        description="Invert concave/convex cavity direction if the mesh normal orientation needs it.")
    sc.snap_uv_cavity_auto_preview = bpy.props.BoolProperty(
        name="Auto Preview",
        default=True,
        description="After Ctrl/Cmd+click cavity mapping, reapply it automatically when cavity settings change.")
    sc.snap_uv_last_cell_x = bpy.props.IntProperty(
        name="Last Cell X",
        default=0,
        min=0,
        description="Internal storage for the last selected palette cell column.")
    sc.snap_uv_last_cell_y_top = bpy.props.IntProperty(
        name="Last Cell Y",
        default=0,
        min=0,
        description="Internal storage for the last selected palette cell row from the top.")
    sc.snap_uv_painting_active = bpy.props.BoolProperty(
        name="Painting Active", default=False,
        description="Internal flag used to stop the active painting modal operator.")


def clear_properties():
    sc = bpy.types.Scene
    property_names = (
        "snap_uv_texture_width", "snap_uv_texture_height",
        "snap_uv_cell_width", "snap_uv_cell_height",
        "snap_uv_margin_x", "snap_uv_margin_y",
        "snap_uv_preserve", "snap_uv_independent",
        "snap_uv_path_points", "snap_uv_path_screen_points",
        "snap_uv_path_debug", "snap_uv_path_colors",
        "snap_uv_path_style", "snap_uv_gradient_direction", "snap_uv_show_gradients", "snap_uv_gradient_snap", "snap_uv_easy_mode", "snap_uv_easy_through", "snap_uv_easy_variant", "snap_uv_easy_drag_gradient",
        "snap_uv_path_stabilizer", "snap_uv_cavity_strength",
        "snap_uv_edge_strength", "snap_uv_edge_threshold",
        "snap_uv_edge_falloff", "snap_uv_cavity_smooth",
        "snap_uv_cavity_contrast", "snap_uv_cavity_bias",
        "snap_uv_cavity_invert", "snap_uv_cavity_auto_preview",
        "snap_uv_last_cell_x", "snap_uv_last_cell_y_top",
        "snap_uv_painting_active", "snap_uv_cavity_expanded", "snap_uv_controls_expanded",
    )
    for property_name in property_names:
        if hasattr(sc, property_name):
            delattr(sc, property_name)


def reset_painting_state():
    global active_gradient_painter
    if active_gradient_painter is not None:
        active_gradient_painter.finish_painting(bpy.context)
    active_gradient_painter = None
    clear_uv_box_preview()
    try:
        scenes = list(bpy.data.scenes)
    except AttributeError:
        return None

    for scene in scenes:
        if hasattr(scene, "snap_uv_painting_active"):
            scene.snap_uv_painting_active = False
        if hasattr(scene, "snap_uv_path_points"):
            scene.snap_uv_path_points = ""
        if hasattr(scene, "snap_uv_path_screen_points"):
            scene.snap_uv_path_screen_points = ""
        if hasattr(scene, "snap_uv_path_colors"):
            scene.snap_uv_path_colors = ""
    return None

# --- Operator ---

class UV_OT_draw_path_gradient(bpy.types.Operator):
    """Draw a surface path in the 3D View for path-based gradient UV placement."""
    bl_idname = "uv.draw_path_gradient"
    bl_label = "Draw Path Gradient"
    bl_options = {'REGISTER', 'UNDO'}

    min_point_distance = 0.003

    @classmethod
    def poll(cls, context):
        obj = context.edit_object
        return obj is not None and obj.type == 'MESH' and obj.mode == 'EDIT'

    def invoke(self, context, event):
        global active_gradient_painter
        self.gradient_editor = None
        self.gradient_snap_cache = None
        self.gradient_snap_target = None
        self.gradient_signature = None
        self.last_gradient_sync = 0.0
        self.paint_undo = []
        self.paint_redo = []
        self.easy_stroke = None
        self.easy_click_pending = None
        self.easy_gradient_drag = False
        self.easy_selection = None
        self.easy_auto_selection = False
        self.paint_batch = None
        if not context.tool_settings.use_uv_select_sync:
            self.report({'ERROR'}, "UV Sync Selection must be enabled in the UV Editor")
            return {'CANCELLED'}
        obj = context.edit_object
        if obj is None or obj.type != 'MESH' or obj.mode != 'EDIT':
            self.report({'ERROR'}, "Active object must be a mesh in Edit Mode")
            return {'CANCELLED'}

        uv_area = context.area if context.area.type == 'IMAGE_EDITOR' else None
        if uv_area is None:
            for area in context.window.screen.areas:
                if area.type == 'IMAGE_EDITOR':
                    uv_area = area
                    break
        if uv_area is None:
            self.report({'ERROR'}, "Open a UV Editor to pick palette cells")
            return {'CANCELLED'}

        uv_region = None
        for region in uv_area.regions:
            if region.type == 'WINDOW':
                uv_region = region
                break
        if uv_region is None:
            self.report({'ERROR'}, "UV Editor window region not found")
            return {'CANCELLED'}

        view_area = context.area if context.area.type == 'VIEW_3D' else None
        if view_area is None:
            for area in context.window.screen.areas:
                if area.type == 'VIEW_3D':
                    view_area = area
                    break
        if view_area is None:
            self.report({'ERROR'}, "Open a 3D View with the mesh in Edit Mode before drawing")
            return {'CANCELLED'}

        view_space = view_area.spaces.active
        if view_space is None or not hasattr(view_space, "region_3d") or view_space.region_3d is None:
            self.report({'ERROR'}, "3D View region data not found")
            return {'CANCELLED'}

        self.obj = obj
        context.scene.snap_uv_painting_active = True
        self.stop_timer = context.window_manager.event_timer_add(0.05, window=context.window)
        self.area = view_area
        self.region = None
        for region in self.area.regions:
            if region.type == 'WINDOW':
                self.region = region
                break
        if self.region is None:
            self.finish_painting(context)
            self.report({'ERROR'}, "3D View window region not found")
            return {'CANCELLED'}
        self.rv3d = view_space.region_3d
        self.scene = context.scene
        self.uv_area = uv_area
        self.uv_region = uv_region
        self.uv_space = uv_area.spaces.active
        self.state = 'PICK_CELL'
        self.target_ready = False
        self.last_applied_cell_min = None
        self.last_applied_cell_size = None
        self.last_applied_selection_signature = None
        self.last_applied_uv_signature = None
        self.last_applied_settings_signature = None
        self.last_action_mode = None
        self.last_cavity_preview_signature = None
        self.last_cavity_preview_time = 0.0
        self.previous_path_points = context.scene.snap_uv_path_points
        self.previous_screen_points = context.scene.snap_uv_path_screen_points
        self.previous_path_colors = context.scene.snap_uv_path_colors
        self.points = []
        self.screen_points = []
        self.events_seen = 0
        self.raycast_attempts = 0
        self.raycast_hits = 0
        self.edit_bvh = None
        self.last_screen_point = None
        self.draw_modifier_held = False
        self.alt_modifier_held = False
        self.swallow_uv_mouse_type = None
        self.uv_mouse_press = None
        self.uv_mouse_dragging = False
        self.drawing = False
        context.scene.snap_uv_path_points = ""
        context.scene.snap_uv_path_screen_points = ""
        context.scene.snap_uv_path_colors = ""
        context.scene.snap_uv_path_debug = ""
        ensure_path_gradient_overlay()
        ensure_uv_box_overlay()
        clear_uv_box_preview()
        redraw_view3d_areas(context)
        if not self.set_target_cell(
                context,
                getattr(context.scene, "snap_uv_last_cell_x", 0),
                getattr(context.scene, "snap_uv_last_cell_y_top", 0)):
            self.finish_painting(context, restore_previous=True)
            return {'CANCELLED'}
        context.window_manager.modal_handler_add(self)
        active_gradient_painter = self
        self.sync_gradient_editor(context, force=True)
        self.report({'INFO'}, "Last cell selected. Paint now or click another palette cell.")
        return {'RUNNING_MODAL'}

    def finish_drawing(self):
        if getattr(self, "area", None) is not None:
            self.area.tag_redraw()

    def remove_stop_timer(self, context):
        if getattr(self, "stop_timer", None) is not None:
            context.window_manager.event_timer_remove(self.stop_timer)
            self.stop_timer = None

    def finish_painting(self, context, restore_previous=False):
        global active_gradient_painter
        self.easy_click_pending = None
        self.easy_gradient_drag = False
        self.end_easy_stroke(cancel=True)
        if self.easy_selection is not None:
            if not self.easy_selection.confirmed:
                self.easy_selection.restore()
            self.easy_selection = None
        if self.gradient_editor is not None:
            if self.gradient_editor.drag is not None or self.gradient_editor.building:
                self.gradient_editor.finish(cancel=True)
            self.gradient_editor = None
        if active_gradient_painter is self:
            active_gradient_painter = None
        if restore_previous:
            context.scene.snap_uv_path_points = self.previous_path_points
            context.scene.snap_uv_path_screen_points = self.previous_screen_points
            context.scene.snap_uv_path_colors = self.previous_path_colors
        else:
            self.clear_current_path(context)
        context.scene.snap_uv_painting_active = False
        self.uv_mouse_press = None
        self.uv_mouse_dragging = False
        self.swallow_uv_mouse_type = None
        clear_uv_box_preview()
        self.edit_bvh = None
        self.finish_drawing()
        self.remove_stop_timer(context)
        redraw_all_areas(context)

    def raycast_mesh(self, context, event):
        self.raycast_attempts += 1
        area, region, rv3d = view3d_under_mouse(context, event)
        if area is not None:
            self.area = area
            self.region = region
            self.rv3d = rv3d

        if self.region is None or self.rv3d is None:
            return None
        coord = (event.mouse_x - self.region.x, event.mouse_y - self.region.y)
        if not (0 <= coord[0] <= self.region.width and 0 <= coord[1] <= self.region.height):
            return None
        ray_origin = view3d_utils.region_2d_to_origin_3d(self.region, self.rv3d, coord)
        ray_direction = view3d_utils.region_2d_to_vector_3d(self.region, self.rv3d, coord)

        matrix_inv = self.obj.matrix_world.inverted()
        local_origin = matrix_inv @ ray_origin
        local_direction = (matrix_inv.to_3x3() @ ray_direction).normalized()
        if self.obj.mode == 'EDIT':
            try:
                if self.edit_bvh is None:
                    bm = bmesh.from_edit_mesh(self.obj.data)
                    bm.faces.ensure_lookup_table()
                    self.edit_bvh = BVHTree.FromBMesh(bm)
                hit = self.edit_bvh.ray_cast(local_origin, local_direction)
                if hit[0] is not None:
                    self.raycast_hits += 1
                    return self.obj.matrix_world @ hit[0]
            except Exception:
                self.edit_bvh = None

        try:
            self.obj.update_from_editmode()
        except RuntimeError:
            pass

        hit, location, _normal, _face_index = self.obj.ray_cast(local_origin, local_direction)
        if hit:
            self.raycast_hits += 1
            return self.obj.matrix_world @ location
        return None

    def mouse_screen_point(self, context, event):
        area, region, rv3d = view3d_under_mouse(context, event)
        if area is not None:
            self.area = area
            self.region = region
            self.rv3d = rv3d
        if self.region is None:
            return Vector((event.mouse_x, event.mouse_y))
        mouse = Vector((event.mouse_x - self.region.x, event.mouse_y - self.region.y))
        first = not self.screen_points
        if first:
            self.gradient_snap_cache = None
            self.stroke_start_snap = None
            self.stroke_end_snap = None
        self.gradient_snap_target = None
        if self.scene.snap_uv_path_style == 'STRAIGHT' or first:
            local = gradient_snap_point(self, mouse, None)
            if first:
                self.stroke_start_snap = local.copy() if local is not None else None
            self.stroke_end_snap = local.copy() if local is not None else None
            if local is not None:
                return view3d_utils.location_3d_to_region_2d(
                    self.region, self.rv3d, self.obj.matrix_world @ local)
        else:
            self.stroke_end_snap = None
        return mouse

    def append_point(self, point, screen_point):
        if screen_point is None:
            return
        stabilizer = getattr(self.scene, "snap_uv_path_stabilizer", 0.55)
        snapped = self.gradient_snap_target is not None
        if snapped:
            point = self.obj.matrix_world @ self.gradient_snap_target[0]
        else:
            screen_point = stabilized_screen_point(self.last_screen_point, screen_point, stabilizer)
        min_distance = 0.001 if snapped else 2.0 + stabilizer * 5.0
        if self.last_screen_point is not None and (screen_point - self.last_screen_point).length < min_distance:
            return
        if not snapped and point is not None and self.points and (point - self.points[-1]).length < self.min_point_distance:
            return
        if point is not None:
            self.points.append(point)
        self.screen_points.append(screen_point)
        self.last_screen_point = screen_point
        self.scene.snap_uv_path_points = serialize_path_points(self.points)
        self.scene.snap_uv_path_screen_points = serialize_screen_points(self.screen_points)
        if getattr(self, "area", None) is not None:
            self.area.tag_redraw()

    def smooth_current_path(self, context):
        if context.scene.snap_uv_path_style != 'FREEHAND' or len(self.screen_points) < 3:
            return
        stabilizer = getattr(context.scene, "snap_uv_path_stabilizer", 0.55)
        self.screen_points = smooth_freehand_screen_points(self.screen_points, stabilizer)
        context.scene.snap_uv_path_screen_points = serialize_screen_points(self.screen_points)
        if getattr(self, "area", None) is not None:
            self.area.tag_redraw()

    def set_target_cell(self, context, target_cell_x, target_cell_y_top):
        scene = context.scene
        self.target_cell_x = target_cell_x
        self.target_cell_y_top = target_cell_y_top
        tex_width = scene.snap_uv_texture_width
        tex_height = scene.snap_uv_texture_height
        cell_width_px = scene.snap_uv_cell_width
        cell_height_px = scene.snap_uv_cell_height
        grid_cell_width_uv = cell_width_px / tex_width
        grid_cell_height_uv = cell_height_px / tex_height

        margin_x_uv = scene.snap_uv_margin_x * grid_cell_width_uv
        margin_y_uv = scene.snap_uv_margin_y * grid_cell_height_uv
        effective_cell_width_uv = grid_cell_width_uv - 2 * margin_x_uv
        effective_cell_height_uv = grid_cell_height_uv - 2 * margin_y_uv
        if effective_cell_width_uv <= 0 or effective_cell_height_uv <= 0:
            self.report({'ERROR'}, "Margins are too large for the given cell size")
            return False

        self.target_min_u = target_cell_x * grid_cell_width_uv + margin_x_uv
        self.target_min_v = 1.0 - ((target_cell_y_top + 1) * grid_cell_height_uv) + margin_y_uv
        self.grid_cell_width_uv = grid_cell_width_uv
        self.grid_cell_height_uv = grid_cell_height_uv
        self.margin_x_uv = margin_x_uv
        self.margin_y_uv = margin_y_uv
        self.effective_cell_width_uv = effective_cell_width_uv
        self.effective_cell_height_uv = effective_cell_height_uv
        self.gradient_direction = scene.snap_uv_gradient_direction
        scene.snap_uv_last_cell_x = target_cell_x
        scene.snap_uv_last_cell_y_top = target_cell_y_top

        image = getattr(self.uv_space, "image", None)
        colors = sample_palette_gradient(
            image, target_cell_x, target_cell_y_top, cell_width_px, cell_height_px,
            self.gradient_direction)
        scene.snap_uv_path_colors = serialize_gradient_colors(colors)
        self.target_ready = True
        self.state = 'DRAW_PATH'
        self.uv_area.tag_redraw()
        return True

    def refresh_live_settings(self, context):
        scene = context.scene
        self.gradient_direction = scene.snap_uv_gradient_direction
        if not getattr(self, "target_ready", False):
            return True

        target_cell_x = getattr(self, "target_cell_x", getattr(scene, "snap_uv_last_cell_x", 0))
        target_cell_y_top = getattr(self, "target_cell_y_top", getattr(scene, "snap_uv_last_cell_y_top", 0))
        tex_width = scene.snap_uv_texture_width
        tex_height = scene.snap_uv_texture_height
        cell_width_px = scene.snap_uv_cell_width
        cell_height_px = scene.snap_uv_cell_height
        grid_cell_width_uv = cell_width_px / tex_width
        grid_cell_height_uv = cell_height_px / tex_height

        margin_x_uv = scene.snap_uv_margin_x * grid_cell_width_uv
        margin_y_uv = scene.snap_uv_margin_y * grid_cell_height_uv
        effective_cell_width_uv = grid_cell_width_uv - 2 * margin_x_uv
        effective_cell_height_uv = grid_cell_height_uv - 2 * margin_y_uv
        if effective_cell_width_uv <= 0 or effective_cell_height_uv <= 0:
            self.report({'ERROR'}, "Margins are too large for the given cell size")
            return False

        self.target_min_u = target_cell_x * grid_cell_width_uv + margin_x_uv
        self.target_min_v = 1.0 - ((target_cell_y_top + 1) * grid_cell_height_uv) + margin_y_uv
        self.grid_cell_width_uv = grid_cell_width_uv
        self.grid_cell_height_uv = grid_cell_height_uv
        self.margin_x_uv = margin_x_uv
        self.margin_y_uv = margin_y_uv
        self.effective_cell_width_uv = effective_cell_width_uv
        self.effective_cell_height_uv = effective_cell_height_uv
        image = getattr(getattr(self, "uv_space", None), "image", None)
        if image is not None:
            colors = sample_palette_gradient(
                image, target_cell_x, target_cell_y_top, cell_width_px, cell_height_px,
                self.gradient_direction)
            scene.snap_uv_path_colors = serialize_gradient_colors(colors)
        return True

    def fit_settings_signature(self, context):
        scene = context.scene
        return (
            bool(scene.snap_uv_preserve),
            bool(scene.snap_uv_independent),
            round(self.grid_cell_width_uv, 12),
            round(self.grid_cell_height_uv, 12),
            round(self.margin_x_uv, 12),
            round(self.margin_y_uv, 12),
            round(self.effective_cell_width_uv, 12),
            round(self.effective_cell_height_uv, 12),
        )

    def cavity_settings_signature(self, context):
        scene = context.scene
        target_cell_x = getattr(self, "target_cell_x", getattr(scene, "snap_uv_last_cell_x", 0))
        target_cell_y_top = getattr(self, "target_cell_y_top", getattr(scene, "snap_uv_last_cell_y_top", 0))
        return (
            target_cell_x,
            target_cell_y_top,
            scene.snap_uv_gradient_direction,
            int(scene.snap_uv_texture_width),
            int(scene.snap_uv_texture_height),
            int(scene.snap_uv_cell_width),
            int(scene.snap_uv_cell_height),
            round(scene.snap_uv_margin_x, 6),
            round(scene.snap_uv_margin_y, 6),
            round(scene.snap_uv_cavity_strength, 4),
            round(scene.snap_uv_edge_strength, 4),
            round(scene.snap_uv_edge_threshold, 4),
            int(scene.snap_uv_edge_falloff),
            int(scene.snap_uv_cavity_smooth),
            round(scene.snap_uv_cavity_contrast, 4),
            round(scene.snap_uv_cavity_bias, 4),
            bool(scene.snap_uv_cavity_invert),
            round(self.effective_cell_width_uv, 12),
            round(self.effective_cell_height_uv, 12),
        )

    def maybe_auto_preview_cavity(self, context):
        if self.last_action_mode != 'CAVITY':
            return
        if not getattr(context.scene, "snap_uv_cavity_auto_preview", True):
            return
        now = time.perf_counter()
        if now - self.last_cavity_preview_time < 0.25:
            return
        signature = self.cavity_settings_signature(context)
        if signature == self.last_cavity_preview_signature:
            return
        self.last_cavity_preview_time = now
        self.apply_cavity_gradient(context, report_result=False)

    def pick_cell_from_event(self, context, event):
        local_x = event.mouse_x - self.uv_region.x
        local_y = event.mouse_y - self.uv_region.y
        if not (0 <= local_x <= self.uv_region.width and 0 <= local_y <= self.uv_region.height):
            self.report({'WARNING'}, "Click a palette cell inside the UV Editor image area")
            return False

        view2d = self.uv_region.view2d
        if view2d is None:
            self.report({'ERROR'}, "view2d not found in the UV Editor")
            return False
        uv_click = view2d.region_to_view(local_x, local_y)

        scene = context.scene
        cell_width_px = scene.snap_uv_cell_width
        cell_height_px = scene.snap_uv_cell_height
        grid_cell_width_uv = cell_width_px / scene.snap_uv_texture_width
        grid_cell_height_uv = cell_height_px / scene.snap_uv_texture_height
        target_cell_x = max(0, int(math.floor(uv_click[0] / grid_cell_width_uv)))
        target_cell_y_top = max(0, int(math.floor((1.0 - uv_click[1]) / grid_cell_height_uv)))

        if not self.set_target_cell(context, target_cell_x, target_cell_y_top):
            return False
        self.report({'INFO'}, "Click: palette action. Shift+Ctrl/Cmd+click: select cell UVs.")
        return True

    def apply_drawn_gradient(self, context):
        if not self.refresh_live_settings(context):
            return False
        if not self.target_ready:
            return False
        if len(self.screen_points) < 2:
            self.report({'ERROR'}, "Path needs at least two screen points")
            return False

        obj = context.edit_object or self.obj
        if obj is None or obj.type != 'MESH' or obj.mode != 'EDIT':
            self.report({'ERROR'}, "The active object must be a mesh in Edit Mode")
            return False

        bm = bmesh.from_edit_mesh(obj.data)
        uv_layer = bm.loops.layers.uv.active
        if uv_layer is None:
            uv_layer = bm.loops.layers.uv.verify()
        loops_data = (self.easy_stroke.resolve(self.screen_points) if self.easy_stroke is not None
                      else selected_face_loop_data(bm, uv_layer, context.tool_settings))
        if not loops_data:
            self.end_easy_stroke(cancel=True)
            self.clear_current_path(context)
            self.report({'ERROR'}, "No UVs selected")
            return False

        (path_min_u, path_min_v,
         path_width_uv, path_height_uv) = safe_gradient_bounds(
            self.target_min_u, self.target_min_v,
            self.effective_cell_width_uv, self.effective_cell_height_uv,
            self.margin_x_uv, self.margin_y_uv,
            context.scene.snap_uv_texture_width,
            context.scene.snap_uv_texture_height)
        apply_path_gradient_screen_uvs(
            loops_data, obj, uv_layer, self.screen_points, self.region, self.rv3d,
            path_min_u, path_min_v, path_width_uv,
            path_height_uv, self.gradient_direction)
        bmesh.update_edit_mesh(obj.data, loop_triangles=False, destructive=False)
        self.last_applied_cell_min = Vector((self.target_min_u, self.target_min_v))
        self.last_applied_cell_size = Vector((self.effective_cell_width_uv, self.effective_cell_height_uv))
        self.last_applied_selection_signature = loops_selection_signature(loops_data)
        self.last_applied_settings_signature = self.fit_settings_signature(context)
        self.last_action_mode = 'PATH'
        bm.faces.index_update()
        bm.verts.index_update()
        local_path = gradient_local_path(obj, loops_data, self.screen_points, self.region, self.rv3d)
        # Screen coordinates lose surface depth. Keep actual snapped mesh positions
        # so the saved handles remain attached when the view changes.
        if getattr(self, 'stroke_start_snap', None) is not None:
            local_path[0] = list(self.stroke_start_snap)
        if getattr(self, 'stroke_end_snap', None) is not None:
            local_path[-1] = list(self.stroke_end_snap)
        save_gradient_record(obj, uv_layer, loops_data, {
            'kind': context.scene.snap_uv_path_style,
            'path': local_path,
            'bounds': [path_min_u, path_min_v, path_width_uv, path_height_uv],
            'direction': self.gradient_direction,
            'colors': context.scene.snap_uv_path_colors,
        })
        self.end_easy_stroke()
        self.sync_gradient_editor(context, force=True)
        redraw_all_areas(context)
        return True

    def pick_source_object(self, context, event):
        area, region, rv3d = view3d_under_mouse(context, event)
        if area is None or region is None or rv3d is None:
            return None
        coord = (event.mouse_x - region.x, event.mouse_y - region.y)
        ray_origin = view3d_utils.region_2d_to_origin_3d(region, rv3d, coord)
        ray_direction = view3d_utils.region_2d_to_vector_3d(region, rv3d, coord)
        depsgraph = context.evaluated_depsgraph_get()
        hit, _location, _normal, _index, hit_obj, _matrix = context.scene.ray_cast(
            depsgraph, ray_origin, ray_direction)
        if hit and hit_obj is not None:
            return hit_obj
        best_obj = None
        best_distance = None
        for candidate in context.scene.objects:
            if candidate.type not in {'MESH', 'EMPTY', 'CURVE', 'SURFACE', 'FONT', 'ARMATURE'}:
                continue
            screen_point = view3d_utils.location_3d_to_region_2d(region, rv3d, candidate.matrix_world.translation)
            if screen_point is None:
                continue
            distance = (screen_point - Vector(coord)).length
            if distance <= 24.0 and (best_distance is None or distance < best_distance):
                best_obj = candidate
                best_distance = distance
        return best_obj

    def apply_distance_gradient_from_object(self, context, source_obj):
        if not self.refresh_live_settings(context):
            return False
        if not self.target_ready or source_obj is None:
            return False
        obj = context.edit_object or self.obj
        if obj is None or obj.type != 'MESH' or obj.mode != 'EDIT':
            self.report({'ERROR'}, "The active object must be a mesh in Edit Mode")
            return False

        bm = bmesh.from_edit_mesh(obj.data)
        uv_layer = bm.loops.layers.uv.active
        if uv_layer is None:
            uv_layer = bm.loops.layers.uv.verify()
        loops_data = selected_face_loop_data(bm, uv_layer, context.tool_settings)
        if not loops_data:
            self.report({'ERROR'}, "No UVs selected")
            return False

        apply_distance_gradient_uvs(
            loops_data, obj, uv_layer, source_obj.matrix_world.translation,
            self.target_min_u, self.target_min_v, self.effective_cell_width_uv,
            self.effective_cell_height_uv, self.gradient_direction)
        bmesh.update_edit_mesh(obj.data, loop_triangles=False, destructive=False)
        forget_gradient_records(obj, uv_layer, loops_data)
        self.gradient_signature = None
        self.last_applied_cell_min = Vector((self.target_min_u, self.target_min_v))
        self.last_applied_cell_size = Vector((self.effective_cell_width_uv, self.effective_cell_height_uv))
        self.last_applied_selection_signature = loops_selection_signature(loops_data)
        self.last_applied_settings_signature = self.fit_settings_signature(context)
        self.last_action_mode = 'DISTANCE'
        self.report({'INFO'}, f"Distance gradient from {source_obj.name}")
        return True

    def apply_radial_gradient_from_center(self, context):
        if not self.refresh_live_settings(context):
            return False
        if not self.target_ready:
            return False
        obj = context.edit_object or self.obj
        if obj is None or obj.type != 'MESH' or obj.mode != 'EDIT':
            self.report({'ERROR'}, "The active object must be a mesh in Edit Mode")
            return False

        bm = bmesh.from_edit_mesh(obj.data)
        uv_layer = bm.loops.layers.uv.active
        if uv_layer is None:
            uv_layer = bm.loops.layers.uv.verify()
        loops_data = selected_face_loop_data(bm, uv_layer, context.tool_settings)
        if not loops_data:
            self.report({'ERROR'}, "No UVs selected")
            return False

        center = loops_world_center(loops_data, obj)
        if center is None:
            self.report({'ERROR'}, "Could not calculate mesh center")
            return False

        apply_distance_gradient_uvs(
            loops_data, obj, uv_layer, center,
            self.target_min_u, self.target_min_v,
            self.effective_cell_width_uv, self.effective_cell_height_uv,
            self.gradient_direction)
        bmesh.update_edit_mesh(obj.data, loop_triangles=False, destructive=False)
        forget_gradient_records(obj, uv_layer, loops_data)
        self.gradient_signature = None
        self.last_applied_cell_min = Vector((self.target_min_u, self.target_min_v))
        self.last_applied_cell_size = Vector((self.effective_cell_width_uv, self.effective_cell_height_uv))
        self.last_applied_selection_signature = loops_selection_signature(loops_data)
        self.last_applied_settings_signature = self.fit_settings_signature(context)
        self.last_action_mode = 'RADIAL'
        self.report({'INFO'}, "Radial gradient applied")
        return True

    def apply_cavity_gradient(self, context, report_result=True):
        if not self.refresh_live_settings(context):
            return False
        if not self.target_ready:
            return False
        obj = context.edit_object or self.obj
        if obj is None or obj.type != 'MESH' or obj.mode != 'EDIT':
            self.report({'ERROR'}, "The active object must be a mesh in Edit Mode")
            return False

        bm = bmesh.from_edit_mesh(obj.data)
        uv_layer = bm.loops.layers.uv.active
        if uv_layer is None:
            uv_layer = bm.loops.layers.uv.verify()
        loops_data = selected_face_loop_data(bm, uv_layer, context.tool_settings)
        if not loops_data:
            self.report({'ERROR'}, "No UVs selected")
            return False

        if not apply_cavity_gradient_uvs(
                loops_data, obj, uv_layer,
                self.target_min_u, self.target_min_v,
                self.effective_cell_width_uv, self.effective_cell_height_uv,
                self.gradient_direction, context.scene):
            self.report({'ERROR'}, "Could not calculate cavity values")
            return False

        bmesh.update_edit_mesh(obj.data, loop_triangles=False, destructive=False)
        forget_gradient_records(obj, uv_layer, loops_data)
        self.gradient_signature = None
        self.last_applied_cell_min = Vector((self.target_min_u, self.target_min_v))
        self.last_applied_cell_size = Vector((self.effective_cell_width_uv, self.effective_cell_height_uv))
        self.last_applied_selection_signature = loops_selection_signature(loops_data)
        self.last_applied_settings_signature = self.fit_settings_signature(context)
        self.last_action_mode = 'CAVITY'
        self.last_cavity_preview_signature = self.cavity_settings_signature(context)
        if report_result:
            self.report({'INFO'}, "Cavity gradient applied")
        return True

    def apply_current_cell_action(self, context, radial=False, cavity=False,
                                  project_from_view=False, select_cell=False):
        if select_cell:
            return self.select_current_cell_uvs(context)
        if project_from_view:
            applied = self.apply_selected_to_current_cell(
                context, project_from_view=True)
            if applied:
                self.sync_gradient_editor(context, force=True)
                redraw_all_areas(context)
            return applied
        if cavity:
            return self.apply_cavity_gradient(context)
        if radial:
            return self.apply_radial_gradient_from_center(context)
        return self.apply_selected_to_current_cell(context)

    def select_current_cell_uvs(self, context):
        if not self.refresh_live_settings(context):
            return False
        if not self.target_ready:
            return False
        if not run_uv_cell_select(
                context, self.uv_area, self.uv_region, self.uv_space,
                self.target_cell_x, self.target_cell_y_top,
                self.grid_cell_width_uv, self.grid_cell_height_uv,
                mode='SET'):
            self.report({'WARNING'}, "Could not select UVs in the palette cell")
            return False
        self.last_action_mode = 'SELECT_CELL'
        self.report({'INFO'}, "Selected UVs in the palette cell")
        return True

    def apply_selected_to_current_cell(self, context, project_from_view=False):
        if not self.refresh_live_settings(context):
            return False
        if not self.target_ready:
            return False

        obj = context.edit_object or self.obj
        if obj is None or obj.type != 'MESH' or obj.mode != 'EDIT':
            self.report({'ERROR'}, "The active object must be a mesh in Edit Mode")
            return False

        bm = bmesh.from_edit_mesh(obj.data)
        uv_layer = bm.loops.layers.uv.active
        had_uv_layer = uv_layer is not None
        if uv_layer is None:
            uv_layer = bm.loops.layers.uv.verify()
        all_selected_loops = selected_face_loop_data(bm, uv_layer, context.tool_settings)
        if not all_selected_loops:
            self.report({'ERROR'}, "No UVs selected")
            return False
        undo_loops = all_selected_loops
        bm.faces.index_update()
        bm.verts.index_update()
        if not project_from_view:
            record = matching_gradient(obj, uv_layer, all_selected_loops)
            if record is not None:
                bounds = safe_gradient_bounds(
                    self.target_min_u, self.target_min_v,
                    self.effective_cell_width_uv, self.effective_cell_height_uv,
                    self.margin_x_uv, self.margin_y_uv,
                    context.scene.snap_uv_texture_width, context.scene.snap_uv_texture_height)
                if remap_saved_gradient(obj, uv_layer, all_selected_loops, record, bounds,
                                        self.gradient_direction, context.scene.snap_uv_path_colors):
                    bmesh.update_edit_mesh(obj.data, loop_triangles=False, destructive=False)
                    obj.data.update()
                    self.last_action_mode = 'PATH'
                    self.last_applied_selection_signature = None
                    self.sync_gradient_editor(context, force=True)
                    redraw_all_areas(context)
                    return True
        current_signature = loops_selection_signature(all_selected_loops)
        current_settings_signature = self.fit_settings_signature(context)
        if (not project_from_view and
                self.last_applied_cell_min is not None and
                self.last_applied_cell_size is not None and
                self.last_applied_selection_signature == current_signature and
                self.last_applied_uv_signature == tuple(tuple(loop[uv_layer].uv) for loop, _ in all_selected_loops) and
                self.last_applied_settings_signature == current_settings_signature):
            old_min = self.last_applied_cell_min
            old_size = self.last_applied_cell_size
            if old_size.x > 1e-12 and old_size.y > 1e-12:
                for loop, uv_orig in all_selected_loops:
                    rel_x = (uv_orig.x - old_min.x) / old_size.x
                    rel_y = (uv_orig.y - old_min.y) / old_size.y
                    loop[uv_layer].uv = Vector((
                        self.target_min_u + rel_x * self.effective_cell_width_uv,
                        self.target_min_v + rel_y * self.effective_cell_height_uv))
                bmesh.update_edit_mesh(obj.data, loop_triangles=False, destructive=False)
                forget_gradient_records(obj, uv_layer, undo_loops)
                self.gradient_signature = None
                self.last_applied_cell_min = Vector((self.target_min_u, self.target_min_v))
                self.last_applied_cell_size = Vector((self.effective_cell_width_uv, self.effective_cell_height_uv))
                self.last_applied_selection_signature = current_signature
                self.last_applied_uv_signature = tuple(tuple(loop[uv_layer].uv) for loop, _ in all_selected_loops)
                self.last_applied_settings_signature = current_settings_signature
                self.last_action_mode = 'FIT'
                obj.data.update()
                self.sync_gradient_editor(context, force=True)
                redraw_all_areas(context)
                return True
        if project_from_view or not had_uv_layer:
            if not project_loops_from_view(
                    all_selected_loops, obj, uv_layer, self.region, self.rv3d):
                if project_from_view:
                    self.report({'ERROR'}, "Could not project the selection from the current 3D View")
                    return False
            else:
                all_selected_loops = selected_face_loop_data(
                    bm, uv_layer, context.tool_settings)

        preserve_value = (
            False if project_from_view else context.scene.snap_uv_preserve)

        if context.scene.snap_uv_independent:
            islands = get_selected_uv_islands(
                bm, uv_layer, context.tool_settings)
            applied = False
            for island in islands:
                island_loops = [
                    (loop, loop[uv_layer].uv.copy()) for loop in island]
                if not island_loops:
                    continue
                fit_loops_to_cell(
                    island_loops, uv_layer, self.target_min_u, self.target_min_v,
                    self.effective_cell_width_uv, self.effective_cell_height_uv,
                    self.grid_cell_width_uv, self.grid_cell_height_uv,
                    self.margin_x_uv, self.margin_y_uv, preserve_value)
                applied = True
        else:
            fit_loops_to_cell(
                all_selected_loops, uv_layer, self.target_min_u, self.target_min_v,
                self.effective_cell_width_uv, self.effective_cell_height_uv,
                self.grid_cell_width_uv, self.grid_cell_height_uv,
                self.margin_x_uv, self.margin_y_uv, preserve_value)
            applied = True

        if not applied:
            self.report({'ERROR'}, "No UVs selected")
            return False

        bmesh.update_edit_mesh(obj.data, loop_triangles=False, destructive=False)
        forget_gradient_records(obj, uv_layer, undo_loops)
        self.gradient_signature = None
        self.last_applied_cell_min = Vector((self.target_min_u, self.target_min_v))
        self.last_applied_cell_size = Vector((self.effective_cell_width_uv, self.effective_cell_height_uv))
        self.last_applied_selection_signature = current_signature
        self.last_applied_uv_signature = tuple(tuple(loop[uv_layer].uv) for loop, _ in all_selected_loops)
        self.last_applied_settings_signature = current_settings_signature
        self.last_action_mode = 'PROJECT_FROM_VIEW' if project_from_view else 'FIT'
        if project_from_view:
            self.report({'INFO'}, "Projected from view into cell; gradient removed from selection")
        return True

    def sync_gradient_editor(self, context, force=False):
        if self.easy_selection is not None and not self.easy_selection.confirmed:
            self.gradient_editor = None
            self.gradient_signature = None
            return
        editor = self.gradient_editor
        if editor is not None and (editor.drag is not None or editor.building):
            return
        if self.drawing or not context.scene.snap_uv_show_gradients:
            self.gradient_editor = None
            self.gradient_signature = None
            self.area.tag_redraw()
            return
        selection = gradient_selection(context)
        if selection is None:
            self.gradient_editor = None
            self.gradient_signature = None
            self.area.tag_redraw()
            return
        obj, _bm, uv, loops = selection
        signature = (obj.as_pointer(), uv.name, tuple(gradient_loop_keys(loops)),
                     tuple(tuple(loop[uv].uv) for loop, _ in loops),
                     obj.data.get(GRADIENT_RECORDS_KEY, ''))
        if (not force and signature == self.gradient_signature
                and (editor is None or (editor.bm.is_valid and all(loop.is_valid for loop, _ in editor.loops)))):
            return
        self.gradient_signature = signature
        record = matching_gradient(obj, uv, loops)
        self.gradient_editor = PaletteGradientEdit(self, selection, record) if record else None
        self.area.tag_redraw()

    def preview_first_snap(self, context, event):
        editor = self.gradient_editor
        if self.drawing or (editor is not None and (editor.drag is not None or editor.building)):
            return
        if event.type not in {'MOUSEMOVE', 'TAB', 'F8', 'LEFT_SHIFT', 'RIGHT_SHIFT'}:
            return
        if not context.scene.snap_uv_gradient_snap:
            self.gradient_snap_target = None
            self.area.tag_redraw()
            return
        area, region, rv3d = view3d_under_mouse(context, event)
        if area is None or mouse_over_ui_region(context, event):
            self.gradient_snap_target = None
            self.area.tag_redraw()
            return
        if event.type == 'TAB' and event.value == 'PRESS':
            self.gradient_snap_cache = None
        self.area, self.region, self.rv3d = area, region, rv3d
        mouse = Vector((event.mouse_x-region.x, event.mouse_y-region.y))
        gradient_snap_point(self, mouse, None)
        self.area.tag_redraw()

    def undo_paint_step(self, context, redo=False):
        editor = self.gradient_editor
        if editor is not None and (editor.drag is not None or editor.building):
            editor.finish(cancel=True)
            editor.building = False
            self.gradient_editor = None
            self.sync_gradient_editor(context, force=True)
            return
        if self.drawing:
            self.end_easy_stroke(cancel=True)
            self.drawing = False
            self.points, self.screen_points = [], []
            self.last_screen_point = None
            self.clear_current_path(context)
            self.sync_gradient_editor(context, force=True)
            return
        source, target = (self.paint_redo, self.paint_undo) if redo else (self.paint_undo, self.paint_redo)
        if not source:
            self.report({'INFO'}, 'No more painting steps to redo' if redo else 'No more painting steps to undo')
            return
        step = source[-1]
        bm = bmesh.from_edit_mesh(self.obj.data)
        bm.faces.ensure_lookup_table()
        bm.verts.index_update()
        uv = bm.loops.layers.uv.get(step['layer'])
        expected = step['before'] if redo else step['after']
        desired = step['after'] if redo else step['before']
        records = step['records_before'] if redo else step['records_after']
        resolved = []
        valid = (uv is not None and (len(bm.verts), len(bm.edges), len(bm.faces)) == step['topology']
                 and self.obj.data.get(GRADIENT_RECORDS_KEY, '[]') == records)
        if valid:
            for key, old_uv in expected.items():
                face, corner, vert = map(int, key.split(':'))
                if face >= len(bm.faces) or corner >= len(bm.faces[face].loops):
                    valid = False
                    break
                loop = bm.faces[face].loops[corner]
                if loop.vert.index != vert or (loop[uv].uv-Vector(old_uv)).length > 1e-5:
                    valid = False
                    break
                resolved.append((loop, desired[key]))
        if not valid:
            self.paint_undo.clear()
            self.paint_redo.clear()
            self.report({'WARNING'}, 'Painting history reset: mesh or UVs were changed outside painting')
            return
        for loop, value in resolved:
            loop[uv].uv = value
        self.obj.data[GRADIENT_RECORDS_KEY] = step['records_after'] if redo else step['records_before']
        bmesh.update_edit_mesh(self.obj.data, loop_triangles=False, destructive=False)
        self.obj.data.update()
        source.pop()
        target.append(step)
        self.gradient_editor = None
        self.gradient_signature = None
        self.gradient_snap_cache = None
        self.gradient_snap_target = None
        self.last_action_mode = None
        self.last_applied_selection_signature = None
        self.sync_gradient_editor(context, force=True)
        redraw_all_areas(context)

    def begin_easy_stroke(self, context):
        self.end_easy_stroke(cancel=True)
        if context.scene.snap_uv_easy_mode:
            if self.easy_selection is not None and self.easy_selection.confirmed:
                stage = self.easy_selection
                stage.apply()
                fixed_faces = {face for group in stage.groups for face in stage.picker.components[group]}
                self.easy_stroke = EasyStroke(self, fixed_faces=fixed_faces)
            elif context.scene.snap_uv_easy_variant == 'AUTO':
                self.easy_stroke = EasyStroke(self)

    def end_easy_stroke(self, cancel=False):
        if self.easy_stroke is not None:
            if cancel:
                self.easy_stroke.restore(selection=True)
            self.easy_stroke = None

    def preview_easy_path(self, context):
        stroke = self.easy_stroke
        if stroke is None or len(self.screen_points) < 2:
            return
        now = time.perf_counter()
        if now-stroke.last_preview < 0.08:
            return
        stroke.last_preview = now
        loops = stroke.resolve(self.screen_points)
        bounds = safe_gradient_bounds(
            self.target_min_u, self.target_min_v, self.effective_cell_width_uv, self.effective_cell_height_uv,
            self.margin_x_uv, self.margin_y_uv, context.scene.snap_uv_texture_width, context.scene.snap_uv_texture_height)
        apply_path_gradient_screen_uvs(loops, self.obj, stroke.picker.uv, self.screen_points,
                                       self.region, self.rv3d, *bounds, self.gradient_direction)
        bmesh.update_edit_mesh(self.obj.data, loop_triangles=False, destructive=False)
        self.obj.data.update()
        redraw_all_areas(context)

    def handle_staged_easy(self, context, event):
        automatic = context.scene.snap_uv_easy_variant == 'AUTO'
        busy = self.drawing or (self.gradient_editor is not None
                               and (self.gradient_editor.drag is not None or self.gradient_editor.building))
        if busy:
            return None
        preview = getattr(self, 'shift_hover_preview', None)
        if (context.scene.snap_uv_easy_mode and automatic and event.shift
                and not self.easy_auto_selection and not self.draw_modifier_held and not event.alt
                and not mouse_over_ui_region(context, event)):
            area, region, rv3d = view3d_under_mouse(context, event)
            if area is not None:
                self.area, self.region, self.rv3d = area, region, rv3d
                if preview is None or not preview.picker.bm.is_valid:
                    picker = EasyMeshPicker(self)
                    preview = SimpleNamespace(picker=picker, groups=set(), hover=set(),
                                              subtract=False, confirmed=True,
                                              overlay_key=None, overlay_batches=[])
                    self.shift_hover_preview = preview
                preview.groups = {preview.picker.component_for[f] for f in preview.picker.faces if f.select}
                preview.hover = preview.picker.hit(
                    Vector((event.mouse_x-region.x, event.mouse_y-region.y)), context.scene.snap_uv_easy_through)
                preview.subtract = primary_modifier(event)
                self.area.tag_redraw()
            elif preview is not None:
                self.shift_hover_preview = None
                self.area.tag_redraw()
        elif preview is not None:
            self.shift_hover_preview = None
            self.area.tag_redraw()
        if (context.scene.snap_uv_easy_mode and automatic and event.shift
                and event.type == 'LEFTMOUSE' and event.value == 'PRESS'
                and not self.draw_modifier_held and not event.alt
                and not mouse_over_ui_region(context, event)
                and view3d_under_mouse(context, event)[0] is not None):
            self.easy_auto_selection = True
            self.easy_click_pending = None
        enabled = context.scene.snap_uv_easy_mode and (not automatic or self.easy_auto_selection)
        if not enabled:
            self.easy_auto_selection = False
            if self.easy_selection is not None:
                if not self.easy_selection.confirmed:
                    self.easy_selection.restore()
                self.easy_selection = None
                redraw_all_areas(context)
            return None
        if self.easy_selection is None or not self.easy_selection.picker.bm.is_valid:
            self.easy_selection = EasySelectionBrush(self)
            self.last_action_mode = None
        stage = self.easy_selection
        subtract = (event.shift and primary_modifier(event)) if automatic else event.shift
        # Releasing Shift ends only the brush; Space/Enter confirms the set.
        if automatic and not event.shift:
            if stage.dragging:
                stage.checkpoint(stage.gesture_start)
                stage.dragging = False
                stage.last_mouse = None
            if stage.hover:
                stage.hover.clear()
                self.area.tag_redraw()
        if self.easy_click_pending is not None:
            if event.type in {'MOUSEMOVE', 'INBETWEEN_MOUSEMOVE', 'LEFTMOUSE'}:
                return None
            if event.type in {'BACK_SPACE', 'TAB', 'A', 'L', 'WINDOW_DEACTIVATE', 'RET', 'NUMPAD_ENTER', 'SPACE'}:
                self.easy_click_pending = None
        if stage.pending_native:
            stage.pending_native = False
            previous = set(stage.groups)
            stage.groups = {stage.picker.component_for[face] for face in stage.picker.faces
                            if face.is_valid and face.select}
            stage.confirmed = False
            stage.painted = False
            stage.checkpoint(previous)
            stage.apply()
        if mouse_over_ui_region(context, event):
            if event.type == 'LEFTMOUSE' and event.value == 'RELEASE' and stage.dragging:
                stage.dragging = False
                stage.last_mouse = None
                stage.checkpoint(stage.gesture_start)
                return {'RUNNING_MODAL'}
            if event.type == 'MOUSEMOVE':
                stage.hover.clear()
                stage.last_mouse = None
                self.area.tag_redraw()
            return None
        if automatic and not stage.confirmed:
            if event.type == 'TAB':
                self.draw_modifier_held = False
                return {'RUNNING_MODAL'}
            if event.type == 'LEFTMOUSE' and not event.shift:
                # Do not let an ordinary click paint or change the pending set.
                return {'RUNNING_MODAL'}
        if (event.type == 'LEFTMOUSE' and event.value == 'PRESS' and not self.draw_modifier_held
                and not event.shift and not event.alt and not primary_modifier(event)):
            area, region, rv3d = view3d_under_mouse(context, event)
            if area is not None:
                editor = self.gradient_editor
                if editor is None or editor.hit_control(context, event) is None:
                    self.area, self.region, self.rv3d = area, region, rv3d
                    hit = stage.picker.hit(Vector((event.mouse_x-region.x, event.mouse_y-region.y)),
                                           context.scene.snap_uv_easy_through)
                    # A confirmed set can start a gradient in a gap or just
                    # outside a silhouette. Decide click-vs-drag on release.
                    if not hit and not (stage.confirmed and context.scene.snap_uv_easy_drag_gradient):
                        stage.clear()
                        if automatic:
                            self.easy_auto_selection = False
                            self.easy_selection = None
                        return {'RUNNING_MODAL'}
        if event.type in {'RET', 'NUMPAD_ENTER', 'SPACE'}:
            if event.value == 'PRESS' and not getattr(event, 'is_repeat', False):
                if not stage.groups:
                    self.report({'INFO'}, 'Paint-select at least one piece first')
                elif stage.confirmed:
                    self.apply_staged_cell(context)
                else:
                    if stage.dragging:
                        stage.checkpoint(stage.gesture_start)
                    stage.dragging = False
                    stage.confirmed = True
                    stage.painted = False
                    stage.hover.clear()
                    stage.apply()
                    if automatic:
                        self.sync_gradient_editor(context, force=True)
                        redraw_all_areas(context)
                    else:
                        self.apply_staged_cell(context)
            return {'RUNNING_MODAL'}
        if event.type == 'BACK_SPACE':
            if event.value == 'PRESS':
                stage.confirmed = False
                stage.hover.clear()
                stage.apply()
            return {'RUNNING_MODAL'}
        if event.type == 'A' and not primary_modifier(event):
            if event.value == 'PRESS':
                old = set(stage.groups)
                stage.confirmed = False
                stage.groups = set() if event.alt else set(range(len(stage.picker.components)))
                stage.checkpoint(old)
                stage.apply()
            return {'RUNNING_MODAL'}
        if automatic and not event.shift and event.type in {
                'LEFTMOUSE', 'MOUSEMOVE', 'INBETWEEN_MOUSEMOVE', 'LEFT_SHIFT', 'RIGHT_SHIFT'}:
            return None
        if stage.confirmed:
            area, region, rv3d = view3d_under_mouse(context, event)
            if event.type == 'MOUSEMOVE' or (event.type in {'LEFT_SHIFT', 'RIGHT_SHIFT', 'LEFT_CTRL', 'RIGHT_CTRL', 'OSKEY'} and event.shift):
                editor = self.gradient_editor
                over_control = editor is not None and editor.hit_control(context, event) is not None
                hover = (stage.picker.hit(Vector((event.mouse_x-region.x, event.mouse_y-region.y)),
                                          context.scene.snap_uv_easy_through)
                         if area is not None and not self.draw_modifier_held and not over_control else set())
                if hover != stage.hover or stage.subtract != subtract:
                    stage.hover, stage.subtract = hover, subtract
                    self.area.tag_redraw()
            if (event.type != 'LEFTMOUSE' or event.value != 'PRESS' or self.draw_modifier_held
                    or area is None or event.alt or (primary_modifier(event) and not automatic)):
                return None
            editor = self.gradient_editor
            if editor is not None and editor.hit_control(context, event) is not None:
                return None
            if (automatic or context.scene.snap_uv_easy_drag_gradient) and not event.shift and not subtract:
                # A confirmed set stays fixed while click/drag chooses the paint action.
                return None
            # A mesh click starts selection again; gradient handles keep their priority.
            stage.restart_fresh = stage.painted and not event.shift and not automatic
            stage.original_selection = [(elem, elem.select)
                                        for seq in (stage.picker.bm.verts, stage.picker.bm.edges, stage.picker.bm.faces)
                                        for elem in seq]
            stage.confirmed = False
            stage.painted = False
            self.gradient_editor = None
            self.gradient_signature = None
            stage.overlay_key = None
        if event.type == 'Z' and primary_modifier(event):
            if event.value == 'PRESS':
                if stage.dragging:
                    stage.groups = set(stage.gesture_start)
                    stage.dragging = False
                else:
                    source, target = (stage.redo, stage.undo) if event.shift else (stage.undo, stage.redo)
                    if source:
                        target.append(set(stage.groups))
                        stage.groups = source.pop()
                stage.apply()
            return {'RUNNING_MODAL'}
        if event.type == 'TAB':
            if event.value == 'PRESS' and stage.groups:
                if stage.dragging:
                    stage.checkpoint(stage.gesture_start)
                stage.dragging = False
                stage.confirmed = True
                stage.painted = False
                stage.hover.clear()
                stage.apply()
                self.sync_gradient_editor(context, force=True)
                # Continue to the normal Tab drawing shortcut, without applying a cell first.
                return None
            self.draw_modifier_held = False
            if event.value == 'PRESS':
                self.report({'INFO'}, 'Select at least one piece before drawing a gradient')
            return {'RUNNING_MODAL'}
        if event.type == 'WINDOW_DEACTIVATE':
            if stage.dragging:
                stage.checkpoint(stage.gesture_start)
            stage.dragging = False
            stage.last_mouse = None
            stage.hover.clear()
            self.area.tag_redraw()
            return None
        area, region, rv3d = view3d_under_mouse(context, event)
        if event.type == 'LEFTMOUSE' and event.value == 'RELEASE' and stage.dragging:
            if area is not None:
                stage.brush(Vector((event.mouse_x-region.x, event.mouse_y-region.y)), subtract)
            stage.dragging = False
            stage.last_mouse = None
            stage.checkpoint(stage.gesture_start)
            return {'RUNNING_MODAL'}
        if area is None:
            if event.type == 'MOUSEMOVE':
                stage.hover.clear()
                stage.last_mouse = None
                self.area.tag_redraw()
            return None
        self.area, self.region, self.rv3d = area, region, rv3d
        mouse = Vector((event.mouse_x-region.x, event.mouse_y-region.y))
        if event.type == 'LEFTMOUSE' and event.value == 'PRESS' and not event.alt and (automatic or not primary_modifier(event)):
            stage.gesture_start = set(stage.groups)
            if stage.restart_fresh:
                stage.groups = set()
                stage.restart_fresh = False
                stage.apply()
            stage.dragging = True
            stage.last_mouse = None
            stage.brush(mouse, subtract)
            return {'RUNNING_MODAL'}
        if event.type == 'MOUSEMOVE' or (event.type in {'LEFT_SHIFT', 'RIGHT_SHIFT', 'LEFT_CTRL', 'RIGHT_CTRL', 'OSKEY'} and event.shift):
            if stage.dragging:
                stage.brush(mouse, subtract)
            else:
                hover = stage.picker.hit(mouse, context.scene.snap_uv_easy_through)
                if hover != stage.hover or stage.subtract != subtract:
                    stage.hover, stage.subtract = hover, subtract
                    self.area.tag_redraw()
            return {'RUNNING_MODAL'}
        return None

    def apply_staged_cell(self, context, radial=False, cavity=False,
                          project_from_view=False, select_cell=False):
        stage = self.easy_selection
        if stage is None:
            return
        if select_cell:
            if self.select_current_cell_uvs(context):
                previous = set(stage.groups)
                sync = context.tool_settings.use_uv_select_sync
                stage.groups = {
                    stage.picker.component_for[face] for face in stage.picker.faces
                    if face.is_valid and face.select and
                    (sync or any(loop[stage.picker.uv].select for loop in face.loops))}
                stage.confirmed = stage.painted = stage.dragging = False
                stage.hover.clear()
                stage.checkpoint(previous)
                stage.apply()
            return
        if context.scene.snap_uv_easy_variant == 'AUTO' and not stage.confirmed:
            return
        if not stage.groups:
            return
        if not stage.confirmed:
            if stage.dragging:
                stage.checkpoint(stage.gesture_start)
            stage.dragging = False
            stage.confirmed = True
            stage.hover.clear()
        self.paint_batch = []
        try:
            stage.apply()
            if radial or cavity or project_from_view:
                self.apply_current_cell_action(
                    context, radial=radial, cavity=cavity,
                    project_from_view=project_from_view)
            else:
                selection = gradient_selection(context)
                if selection is not None and matching_gradient(selection[0], selection[2], selection[3]) is not None:
                    # A single stroke across multiple pieces remains one editable stroke.
                    self.apply_selected_to_current_cell(context)
                else:
                    for group in sorted(stage.groups):
                        self.paint_easy_piece(context, stage.picker, {group})
        finally:
            step = merge_paint_steps(self.paint_batch)
            self.paint_batch = None
            if step is not None:
                self.paint_undo.append(step)
                trim_paint_history(self)
                self.paint_redo.clear()
            stage.apply()
            stage.painted = True
            self.sync_gradient_editor(context, force=True)
            redraw_all_areas(context)


    def easy_click(self, context, event):
        staged = self.easy_selection is not None
        if (not context.scene.snap_uv_easy_mode
                or (staged and not self.easy_selection.confirmed)
                or self.draw_modifier_held or self.drawing
                or event.type != 'LEFTMOUSE' or event.value != 'PRESS'
                or event.shift or primary_modifier(event) or event.alt or mouse_over_ui_region(context, event)):
            return False
        area, region, rv3d = view3d_under_mouse(context, event)
        if area is None:
            return False
        self.area, self.region, self.rv3d = area, region, rv3d
        picker = self.easy_selection.picker if staged else EasyMeshPicker(self)
        groups = (set(self.easy_selection.groups) if staged else
                  picker.hit(Vector((event.mouse_x-region.x, event.mouse_y-region.y))))
        if context.scene.snap_uv_easy_drag_gradient:
            # Keep the press position: delayed painting must not mutate the UVs
            # which will become the gradient's undo baseline if this is a drag.
            self.easy_click_pending = (SimpleNamespace(
                type='LEFTMOUSE', value='PRESS', mouse_x=event.mouse_x, mouse_y=event.mouse_y,
                shift=False, ctrl=False, alt=False, oskey=False,
                clear_selection_on_click=staged and not picker.hit(
                    Vector((event.mouse_x-region.x, event.mouse_y-region.y)),
                    context.scene.snap_uv_easy_through)), picker, groups)
            return True
        if not groups:
            return False
        if staged:
            self.apply_staged_cell(context)
        else:
            self.paint_easy_piece(context, picker, groups)
        return True

    def handle_easy_click_drag(self, context, event):
        pending = self.easy_click_pending
        if pending is None:
            return False
        staged = self.easy_selection is not None
        if (not context.scene.snap_uv_easy_mode or not context.scene.snap_uv_easy_drag_gradient
                or (staged and (self.easy_selection is None or not self.easy_selection.confirmed))):
            self.easy_click_pending = None
            return False
        release = event.type == 'LEFTMOUSE' and event.value == 'RELEASE'
        if event.type not in {'MOUSEMOVE', 'INBETWEEN_MOUSEMOVE'} and not release:
            return False
        start, picker, groups = pending
        distance_sq = (event.mouse_x-start.mouse_x)**2 + (event.mouse_y-start.mouse_y)**2
        if distance_sq < 25:
            if release:
                self.easy_click_pending = None
                if staged and getattr(start, 'clear_selection_on_click', False):
                    self.easy_selection.clear()
                    if self.easy_auto_selection:
                        self.easy_selection = None
                        self.easy_auto_selection = False
                elif staged:
                    self.apply_staged_cell(context)
                elif groups:
                    self.paint_easy_piece(context, picker, groups)
            return True
        self.easy_click_pending = None
        if not self.refresh_live_settings(context):
            return True
        style = context.scene.snap_uv_path_style
        if style in {'BEZIER', 'CIRCLE'}:
            held = self.draw_modifier_held
            self.draw_modifier_held = True
            try:
                self.handle_gradient_event(context, start)
            finally:
                self.draw_modifier_held = held
            editor = self.gradient_editor
            if editor is None or not editor.building:
                return True
            self.easy_gradient_drag = True
            if style == 'BEZIER':
                # A drag creates a two-point curve; Tab remains the multi-point tool.
                editor.drag = None
                endpoint = SimpleNamespace(**vars(start))
                endpoint.mouse_x, endpoint.mouse_y = event.mouse_x, event.mouse_y
                editor.event(context, endpoint)
                editor.drag = (1, 1)
            # Continue processing this movement/release through the existing editor.
            return False
        self.edit_bvh = None
        self.drawing = True
        self.points, self.screen_points = [], []
        self.last_screen_point = None
        self.begin_easy_stroke(context)
        self.append_point(self.raycast_mesh(context, start), self.mouse_screen_point(context, start))
        return False

    def paint_easy_piece(self, context, picker, groups):
        loops = picker.select(groups)
        bmesh.update_edit_mesh(self.obj.data, loop_triangles=False, destructive=False)
        self.gradient_editor = None
        self.last_applied_selection_signature = None
        if not self.refresh_live_settings(context):
            return True
        coords = [value for _loop, value in loops]
        center = sum(coords, Vector((0,0)))/len(coords)
        cw, ch = self.grid_cell_width_uv, self.grid_cell_height_uv
        cx, cy = math.floor(center.x/cw), math.floor((1-center.y)/ch)
        placed = (cx >= 0 and cy >= 0 and (cx+1)*cw <= 1+1e-6 and (cy+1)*ch <= 1+1e-6
                  and all(cx*cw-1e-6 <= v.x <= (cx+1)*cw+1e-6
                          and 1-(cy+1)*ch-1e-6 <= v.y <= 1-cy*ch+1e-6 for v in coords))
        if placed:
            self.last_applied_cell_min = Vector((cx*cw+self.margin_x_uv, 1-(cy+1)*ch+self.margin_y_uv))
            self.last_applied_cell_size = Vector((self.effective_cell_width_uv, self.effective_cell_height_uv))
            self.last_applied_selection_signature = loops_selection_signature(loops)
            self.last_applied_uv_signature = tuple(tuple(loop[picker.uv].uv) for loop, _ in loops)
            self.last_applied_settings_signature = self.fit_settings_signature(context)
        self.apply_selected_to_current_cell(context, project_from_view=not placed)
        self.sync_gradient_editor(context, force=True)
        redraw_all_areas(context)
        return True

    def handle_gradient_event(self, context, event):
        editor = self.gradient_editor
        # Finish only the in-progress handle gesture; the painting session stays active.
        if editor is not None and (editor.drag is not None or editor.building):
            handled = editor.event(context, event)
            if self.easy_gradient_drag and event.type == 'LEFTMOUSE' and event.value == 'RELEASE':
                self.easy_gradient_drag = False
                if editor.building:
                    editor.finish(cancel=len(editor.record['nodes']) < 2)
                    editor.building = False
                    self.sync_gradient_editor(context, force=True)
            return handled
        if (event.type == 'LEFTMOUSE' and event.value == 'PRESS'
                and self.draw_modifier_held and not event.shift
                and context.scene.snap_uv_path_style in {'BEZIER', 'CIRCLE'}):
            area, region, rv3d = view3d_under_mouse(context, event)
            if area is None or mouse_over_ui_region(context, event):
                return False
            self.area, self.region, self.rv3d = area, region, rv3d
            if not self.refresh_live_settings(context):
                return True
            self.begin_easy_stroke(context)
            selection = (self.easy_stroke.selection_data([Vector((event.mouse_x-region.x, event.mouse_y-region.y))])
                         if self.easy_stroke is not None else gradient_selection(context))
            if selection is None:
                self.report({'WARNING'}, 'Select mesh faces with UVs first')
                return True
            bounds = safe_gradient_bounds(
                self.target_min_u, self.target_min_v,
                self.effective_cell_width_uv, self.effective_cell_height_uv,
                self.margin_x_uv, self.margin_y_uv,
                context.scene.snap_uv_texture_width, context.scene.snap_uv_texture_height)
            record = dict(kind=context.scene.snap_uv_path_style, nodes=[], path=[], bounds=list(bounds),
                          direction=self.gradient_direction, colors=context.scene.snap_uv_path_colors)
            self.clear_current_path(context)
            self.gradient_snap_cache = None
            self.gradient_editor = PaletteGradientEdit(self, selection, record, building=True)
            self.last_action_mode = None
            return self.gradient_editor.event(context, event)
        if not context.scene.snap_uv_show_gradients or self.drawing:
            if editor is not None:
                editor.set_hover(None)
            return False
        if editor is not None:
            if event.type in {'MOUSEMOVE', 'INBETWEEN_MOUSEMOVE'}:
                editor.set_hover(editor.hit_control(context, event))
            elif event.type in {'TAB', 'LEFT_SHIFT', 'RIGHT_SHIFT', 'LEFT_CTRL', 'RIGHT_CTRL',
                                'LEFT_ALT', 'RIGHT_ALT', 'OSKEY', 'WINDOW_DEACTIVATE',
                                'MIDDLEMOUSE', 'WHEELUPMOUSE', 'WHEELDOWNMOUSE'}:
                editor.set_hover(None)
        if event.type == 'LEFTMOUSE' and event.value == 'PRESS' and not self.draw_modifier_held:
            # Selection may have changed since the previous timer tick.
            self.sync_gradient_editor(context)
            editor = self.gradient_editor
            if editor is not None:
                return editor.event(context, event)
        return False


    def clear_current_path(self, context):
        self.gradient_snap_target = None
        context.scene.snap_uv_path_points = ""
        context.scene.snap_uv_path_screen_points = ""
        redraw_view3d_areas(context)

    def modal(self, context, event):
        self.events_seen += 1
        if not context.scene.snap_uv_painting_active:
            self.finish_painting(context)
            self.report({'INFO'}, "Painting stopped")
            return {'CANCELLED'}

        if context.edit_object != self.obj or self.obj.mode != 'EDIT':
            self.finish_painting(context)
            return {'CANCELLED'}
        # Consume both press and release before editor/UI handlers can end Painting.
        if context.scene.snap_uv_easy_mode and event.type in {'ESC', 'RIGHTMOUSE'}:
            self.easy_click_pending = None
            self.easy_gradient_drag = False
            if event.value == 'PRESS':
                editor = self.gradient_editor
                if editor is not None and (editor.drag is not None or editor.building):
                    editor.finish(cancel=True)
                self.end_easy_stroke(cancel=True)
                self.drawing = False
                self.draw_modifier_held = False
                self.points, self.screen_points = [], []
                self.last_screen_point = None
                self.clear_current_path(context)
                self.uv_mouse_press = None
                self.uv_mouse_dragging = False
                self.swallow_uv_mouse_type = None
                clear_uv_box_preview()
                if self.easy_selection is not None and self.easy_selection.picker.bm.is_valid:
                    self.easy_selection.clear()
                    if self.easy_auto_selection:
                        self.easy_selection = None
                        self.easy_auto_selection = False
                else:
                    bm = bmesh.from_edit_mesh(self.obj.data)
                    for seq in (bm.faces, bm.edges, bm.verts):
                        for elem in seq:
                            elem.select = False
                    bm.select_history.clear()
                    bmesh.update_edit_mesh(self.obj.data, loop_triangles=False, destructive=False)
                self.gradient_editor = None
                self.gradient_signature = None
                self.last_action_mode = None
                self.last_applied_selection_signature = None
                redraw_all_areas(context)
            return {'RUNNING_MODAL'}
        if event.type in {'LEFT_ALT', 'RIGHT_ALT'}:
            self.alt_modifier_held = event.value != 'RELEASE'
            return {'RUNNING_MODAL'}
        if event.type == 'U' and not mouse_over_ui_region(context, event):
            # Native unwrap/project operators own their menu and UV edits.
            if event.value == 'PRESS':
                editor = self.gradient_editor
                if editor is not None and (editor.drag is not None or editor.building):
                    editor.finish(cancel=True)
                self.end_easy_stroke(cancel=True)
                self.drawing = self.draw_modifier_held = False
                self.easy_click_pending = None
                self.easy_gradient_drag = False
                self.points, self.screen_points = [], []
                self.last_screen_point = None
                self.clear_current_path(context)
                self.gradient_editor = self.gradient_signature = None
                self.last_applied_selection_signature = None
                self.last_applied_uv_signature = None
                self.last_action_mode = None
                if self.easy_selection is not None:
                    stage = self.easy_selection
                    if stage.dragging:
                        stage.checkpoint(stage.gesture_start)
                    stage.dragging = False
                    stage.last_mouse = None
                self.uv_mouse_press = None
                self.uv_mouse_dragging = False
                self.swallow_uv_mouse_type = None
                clear_uv_box_preview()
            return {'PASS_THROUGH'}
        if event.type == 'L' and not mouse_over_ui_region(context, event):
            self.easy_click_pending = None
            if event.value == 'PRESS':
                editor = self.gradient_editor
                if editor is not None and (editor.drag is not None or editor.building):
                    editor.finish(cancel=True)
                if self.drawing:
                    self.end_easy_stroke(cancel=True)
                    self.drawing = False
                    self.points, self.screen_points = [], []
                    self.last_screen_point = None
                    self.clear_current_path(context)
                self.draw_modifier_held = False
                self.gradient_editor = None
                self.gradient_signature = None
                if context.scene.snap_uv_easy_mode and (context.scene.snap_uv_easy_variant == 'SELECT' or self.easy_auto_selection):
                    if self.easy_selection is None:
                        self.easy_selection = EasySelectionBrush(self)
                    self.easy_selection.pending_native = True
                    self.easy_selection.dragging = False
                    self.easy_selection.last_mouse = None
                self.last_gradient_sync = 0.0
            return {'PASS_THROUGH'}
        self.preview_first_snap(context, event)
        staged_result = self.handle_staged_easy(context, event)
        if staged_result is not None:
            return staged_result
        if event.type == 'Z' and primary_modifier(event) and not event.alt and not mouse_over_ui_region(context, event):
            if event.value == 'PRESS':
                self.undo_paint_step(context, redo=event.shift)
            return {'RUNNING_MODAL'}
        if event.type == 'F8' and not mouse_over_ui_region(context, event):
            if event.value == 'PRESS':
                context.scene.snap_uv_gradient_snap = not context.scene.snap_uv_gradient_snap
                self.gradient_snap_target = None
                self.preview_first_snap(context, event)
                self.area.tag_redraw()
            return {'RUNNING_MODAL'}

        # Blender owns Select All / Deselect All (including customized A keymaps).
        # Handle this before a gradient gesture can consume keyboard input.
        if event.type == 'A':
            self.easy_click_pending = None
            if event.value == 'PRESS' and not mouse_over_ui_region(context, event):
                editor = self.gradient_editor
                if editor is not None and (editor.drag is not None or editor.building):
                    editor.finish(cancel=True)
                self.gradient_editor = None
                self.gradient_signature = None
                if self.drawing:
                    self.end_easy_stroke(cancel=True)
                    self.drawing = False
                    self.points = []
                    self.screen_points = []
                    self.last_screen_point = None
                    self.clear_current_path(context)
                self.draw_modifier_held = False
                self.edit_bvh = None
                self.uv_mouse_press = None
                self.uv_mouse_dragging = False
                self.swallow_uv_mouse_type = None
                clear_uv_box_preview()
                # The next timer sees Blender's updated selection, after pass-through.
                self.last_gradient_sync = 0.0
                self.area.tag_redraw()
            return {'PASS_THROUGH'}

        if event.type in {'WINDOW_DEACTIVATE', 'TAB', 'A', 'L'}:
            self.easy_click_pending = None
        if event.type == 'WINDOW_DEACTIVATE':
            self.easy_gradient_drag = False
        if self.handle_easy_click_drag(context, event):
            return {'RUNNING_MODAL'}
        if self.handle_gradient_event(context, event):
            return {'RUNNING_MODAL'}
        if self.easy_click(context, event):
            return {'RUNNING_MODAL'}
        if (self.easy_selection is not None and self.easy_selection.confirmed
                and event.type == 'LEFTMOUSE' and not self.draw_modifier_held and not self.drawing
                and view3d_under_mouse(context, event)[0] is not None
                and not mouse_over_ui_region(context, event)):
            return {'RUNNING_MODAL'}

        if event.type in {'RIGHTMOUSE', 'ESC'}:
            self.finish_painting(context, restore_previous=self.state == 'PICK_CELL')
            self.report({'INFO'}, "Painting finished")
            return {'CANCELLED'}

        if event.type in {'RET', 'NUMPAD_ENTER'} and event.value == 'PRESS':
            self.finish_painting(context)
            self.report({'INFO'}, "Painting finished")
            return {'FINISHED'}

        if event.type == 'TIMER':
            now = time.perf_counter()
            if now - self.last_gradient_sync >= 0.05:
                self.last_gradient_sync = now
                self.maybe_auto_preview_cavity(context)
                self.sync_gradient_editor(context)
            return {'PASS_THROUGH'}


        if event.type == 'WINDOW_DEACTIVATE':
            self.end_easy_stroke(cancel=True)
            self.draw_modifier_held = False
            self.alt_modifier_held = False
            self.swallow_uv_mouse_type = None
            self.uv_mouse_press = None
            self.uv_mouse_dragging = False
            clear_uv_box_preview()
            self.drawing = False
            self.edit_bvh = None
            return {'RUNNING_MODAL'}

        # Real LMB events carry their own modifier state; the held flag is only
        # needed for Option+LMB remapped to MMB by Blender.
        alt_active = bool(event.alt) if event.type == 'LEFTMOUSE' else alt_modifier_active(event, self.alt_modifier_held)
        if event.type == 'LEFTMOUSE' and event.value == 'PRESS':
            self.alt_modifier_held = bool(event.alt)
        if (self.uv_mouse_press is not None and
                event.type in {'MOUSEMOVE', 'INBETWEEN_MOUSEMOVE'}):
            current = Vector((event.mouse_x, event.mouse_y))
            if (current - self.uv_mouse_press["start"]).length >= 6.0:
                self.uv_mouse_dragging = True
                current_local = Vector((
                    event.mouse_x - self.uv_region.x,
                    event.mouse_y - self.uv_region.y))
                set_uv_box_preview(
                    self.uv_area, self.uv_mouse_press["local_start"],
                    current_local)
            return {'RUNNING_MODAL'}

        if (self.uv_mouse_press is not None and
                (event.type == self.uv_mouse_press["mouse_type"] or
                 (self.uv_mouse_press['alt'] and event.type in {'LEFTMOUSE', 'MIDDLEMOUSE'})) and
                event.value == 'RELEASE'):
            press = self.uv_mouse_press
            dragged = self.uv_mouse_dragging
            self.uv_mouse_press = None
            self.uv_mouse_dragging = False
            self.swallow_uv_mouse_type = None
            clear_uv_box_preview()
            if dragged:
                end = Vector((
                    event.mouse_x - self.uv_region.x,
                    event.mouse_y - self.uv_region.y))
                select_mode = (
                    'SUB' if press["primary"] else
                    'ADD' if press["shift"] else 'SET')
                if not run_uv_box_select(
                        context, self.uv_area, self.uv_region, self.uv_space,
                        press["local_start"], end, mode=select_mode):
                    self.report({'WARNING'}, "UV box selection could not be completed")
                return {'RUNNING_MODAL'}

            if self.pick_cell_from_event(context, event):
                if self.easy_selection is not None:
                    self.apply_staged_cell(
                        context,
                        radial=press["shift"] and not press["primary"] and not press["alt"],
                        cavity=press["primary"] and not press["shift"] and not press["alt"],
                        project_from_view=press["alt"],
                        select_cell=press["shift"] and press["primary"] and not press["alt"])
                    return {'RUNNING_MODAL'}
                if len(self.screen_points) >= 2:
                    if self.apply_drawn_gradient(context):
                        self.clear_current_path(context)
                        self.points = []
                        self.screen_points = []
                        self.last_screen_point = None
                else:
                    self.apply_current_cell_action(
                        context,
                        radial=press["shift"] and not press["primary"] and not press["alt"],
                        cavity=press["primary"] and not press["shift"] and not press["alt"],
                        project_from_view=press["alt"],
                        select_cell=press["shift"] and press["primary"] and not press["alt"])
            return {'RUNNING_MODAL'}

        uv_region = getattr(self, "uv_region", None)
        if uv_region is not None:
            in_saved_uv_window = (
                uv_region.x <= event.mouse_x <= uv_region.x + uv_region.width and
                uv_region.y <= event.mouse_y <= uv_region.y + uv_region.height)
            is_cell_mouse = (
                uv_cell_mouse_event(event, self.alt_modifier_held) or
                event.type == self.swallow_uv_mouse_type)
            if in_saved_uv_window and is_cell_mouse:
                if event.value == 'PRESS':
                    clear_uv_box_preview()
                    self.uv_mouse_press = {
                        "mouse_type": event.type,
                        "start": Vector((event.mouse_x, event.mouse_y)),
                        "local_start": Vector((
                            event.mouse_x - uv_region.x,
                            event.mouse_y - uv_region.y)),
                        "shift": bool(event.shift),
                        "primary": primary_modifier(event),
                        "alt": alt_active,
                    }
                    self.uv_mouse_dragging = False
                    self.swallow_uv_mouse_type = event.type
                    return {'RUNNING_MODAL'}
                if self.swallow_uv_mouse_type is not None:
                    return {'RUNNING_MODAL'}

        if mouse_over_ui_region(context, event):
            return {'PASS_THROUGH'}

        if (mouse_over_non_window_region(context, event) and
                not window_region_under_mouse(context, event, {'VIEW_3D'})):
            return {'PASS_THROUGH'}

        uv_area, uv_region = None, None
        view_area, _view_region, _view_rv3d = view3d_under_mouse(context, event)
        if event.type not in {'TAB'} and uv_region is None and view_area is None:
            return {'PASS_THROUGH'}

        if event.type == 'TAB':
            self.draw_modifier_held = event.value == 'PRESS'
            return {'RUNNING_MODAL'}

        if event.type == 'LEFTMOUSE' and event.value == 'PRESS':
            area, _region, _rv3d = view3d_under_mouse(context, event)
            if area is not None and self.draw_modifier_held and event.shift:
                self.refresh_live_settings(context)
                source_obj = self.pick_source_object(context, event)
                if source_obj is None:
                    self.report({'WARNING'}, "No source object under cursor")
                else:
                    self.apply_distance_gradient_from_object(context, source_obj)
                return {'RUNNING_MODAL'}
            if area is not None and self.draw_modifier_held and not event.shift:
                self.refresh_live_settings(context)
                self.edit_bvh = None
                self.drawing = True
                self.points = []
                self.screen_points = []
                self.last_screen_point = None
                self.begin_easy_stroke(context)
                self.append_point(self.raycast_mesh(context, event), self.mouse_screen_point(context, event))
                return {'RUNNING_MODAL'}

        if self.state == 'PICK_CELL':
            if event.type == 'LEFTMOUSE' and event.value == 'PRESS':
                if self.pick_cell_from_event(context, event):
                    if len(self.screen_points) >= 2:
                        if self.apply_drawn_gradient(context):
                            self.clear_current_path(context)
                            self.points = []
                            self.screen_points = []
                            self.last_screen_point = None
                    else:
                        self.apply_current_cell_action(
                            context,
                            radial=event.shift and not primary_modifier(event) and not alt_active,
                            cavity=primary_modifier(event) and not event.shift and not alt_active,
                            project_from_view=alt_active,
                            select_cell=event.shift and primary_modifier(event) and not alt_active)
                    return {'RUNNING_MODAL'}
                return {'RUNNING_MODAL'}
            area, _region, _rv3d = view3d_under_mouse(context, event)
            if area is not None:
                return {'PASS_THROUGH'}
            return {'RUNNING_MODAL'}

        if event.type == 'LEFTMOUSE' and event.value == 'PRESS':
            area, _region, _rv3d = view3d_under_mouse(context, event)
            if area is None:
                local_x = event.mouse_x - self.uv_region.x
                local_y = event.mouse_y - self.uv_region.y
                if 0 <= local_x <= self.uv_region.width and 0 <= local_y <= self.uv_region.height:
                    if self.pick_cell_from_event(context, event):
                        self.apply_current_cell_action(
                            context,
                            radial=event.shift and not primary_modifier(event) and not alt_active,
                            cavity=primary_modifier(event) and not event.shift and not alt_active,
                            project_from_view=alt_active,
                            select_cell=event.shift and primary_modifier(event) and not alt_active)
                    return {'RUNNING_MODAL'}
                return {'RUNNING_MODAL'}
            self.refresh_live_settings(context)
            if not self.draw_modifier_held:
                return {'PASS_THROUGH'}

        if event.type == 'LEFTMOUSE' and event.value == 'PRESS':
            if not self.draw_modifier_held or event.shift:
                return {'PASS_THROUGH'}
            self.edit_bvh = None
            self.drawing = True
            self.points = []
            self.screen_points = []
            self.last_screen_point = None
            self.begin_easy_stroke(context)
            self.append_point(self.raycast_mesh(context, event), self.mouse_screen_point(context, event))
            return {'RUNNING_MODAL'}

        if event.type in {'MOUSEMOVE', 'INBETWEEN_MOUSEMOVE'} and self.drawing:
            if context.scene.snap_uv_path_style == 'STRAIGHT' and self.screen_points:
                point = self.raycast_mesh(context, event)
                screen_point = self.mouse_screen_point(context, event)
                self.points = ([self.points[0], point] if self.points and point is not None
                               else self.points[:1])
                self.screen_points = [self.screen_points[0], screen_point]
                self.scene.snap_uv_path_points = serialize_path_points(self.points)
                self.scene.snap_uv_path_screen_points = serialize_screen_points(self.screen_points)
                if getattr(self, "area", None) is not None:
                    self.area.tag_redraw()
            else:
                self.append_point(self.raycast_mesh(context, event), self.mouse_screen_point(context, event))
            self.preview_easy_path(context)
            return {'RUNNING_MODAL'}

        if event.type == 'LEFTMOUSE' and event.value == 'RELEASE' and self.drawing:
            self.drawing = False
            if context.scene.snap_uv_path_style == 'STRAIGHT' and self.screen_points:
                endpoint = self.mouse_screen_point(context, event)
                self.screen_points = [self.screen_points[0], endpoint]
            if len(self.screen_points) == 1:
                self.append_point(self.raycast_mesh(context, event), self.mouse_screen_point(context, event))
            if len(self.screen_points) < 2:
                self.end_easy_stroke(cancel=True)
                context.scene.snap_uv_path_debug = (
                    f"events={self.events_seen}, attempts={self.raycast_attempts}, "
                    f"hits={self.raycast_hits}, screen_points={len(self.screen_points)}")
                self.finish_drawing()
                self.report({'ERROR'}, "Path needs at least two screen points. " + context.scene.snap_uv_path_debug)
                self.clear_current_path(context)
                self.points, self.screen_points = [], []
                self.last_screen_point = None
                return {'RUNNING_MODAL'}
            self.smooth_current_path(context)
            context.scene.snap_uv_path_points = serialize_path_points(self.points)
            context.scene.snap_uv_path_screen_points = serialize_screen_points(self.screen_points)
            self.finish_drawing()
            if not self.target_ready:
                self.report({'INFO'}, "Path stored. Click a palette cell in the UV Editor to apply it.")
                self.drawing = False
                return {'RUNNING_MODAL'}
            if self.apply_drawn_gradient(context):
                self.clear_current_path(context)
                self.report({'INFO'}, "Path gradient applied")
                self.points = []
                self.screen_points = []
                self.last_screen_point = None
                self.drawing = False
                return {'RUNNING_MODAL'}
            self.end_easy_stroke(cancel=True)
            self.clear_current_path(context)
            self.points = []
            self.screen_points = []
            self.last_screen_point = None
            self.drawing = False
            return {'RUNNING_MODAL'}

        area, _region, _rv3d = view3d_under_mouse(context, event)
        if area is not None and not self.drawing:
            return {'PASS_THROUGH'}

        return {'RUNNING_MODAL'}


# --- Easy Mode: seam-delimited pieces and reversible live targeting ---


def draw_active_palette_cell():
    painter = active_gradient_painter
    context = bpy.context
    if (painter is None or not context.scene.snap_uv_painting_active
            or context.area != painter.uv_area or context.region.type != 'WINDOW'
            or not painter.target_ready):
        return
    import gpu
    from gpu_extras.batch import batch_for_shader
    scene = context.scene
    cw = scene.snap_uv_cell_width / scene.snap_uv_texture_width
    ch = scene.snap_uv_cell_height / scene.snap_uv_texture_height
    x, y = painter.target_cell_x*cw, 1-(painter.target_cell_y_top+1)*ch
    view = context.region.view2d
    corners = [Vector(view.view_to_region(u, v, clip=False))
               for u, v in ((x,y),(x+cw,y),(x+cw,y+ch),(x,y+ch),(x,y))]
    shader = gpu.shader.from_builtin('UNIFORM_COLOR')
    gpu.state.blend_set('ALPHA')
    try:
        for width, color in ((6, (0,0,0,0.8)), (3, (1,0.7,0.12,1))):
            batch = build_screen_polyline_batch(batch_for_shader, corners, width)
            if batch:
                shader.bind()
                shader.uniform_float('color', color)
                batch.draw(shader)
    finally:
        gpu.state.blend_set('NONE')


class EasySelectionBrush:
    """A fixed set of seam-delimited pieces, selected before painting."""

    def __init__(self, painter):
        self.painter = painter
        self.picker = EasyMeshPicker(painter)
        self.original_selection = [(e, e.select) for seq in (self.picker.bm.verts, self.picker.bm.edges, self.picker.bm.faces) for e in seq]
        self.groups = ({self.picker.component_for[f] for f in self.picker.faces if f.select}
                       if painter.scene.snap_uv_easy_variant == 'AUTO' else set())
        self.hover = set()
        self.confirmed = False
        self.painted = False
        self.pending_native = False
        self.restart_fresh = False
        self.dragging = False
        self.subtract = False
        self.last_mouse = None
        self.undo, self.redo = [], []
        self.gesture_start = set()
        self.overlay_key = None
        self.overlay_batches = []
        self.apply()

    def apply(self):
        self.picker.select(self.groups)
        bmesh.update_edit_mesh(self.painter.obj.data, loop_triangles=False, destructive=False)
        self.painter.gradient_editor = None
        self.painter.gradient_signature = None
        self.overlay_key = None
        redraw_all_areas(bpy.context)

    def restore(self):
        if self.picker.bm.is_valid:
            for elem, selected in self.original_selection:
                if elem.is_valid:
                    elem.select = selected
            bmesh.update_edit_mesh(self.painter.obj.data, loop_triangles=False, destructive=False)

    def clear(self):
        previous = set(self.groups)
        self.groups.clear()
        self.hover.clear()
        self.confirmed = False
        self.painted = False
        self.dragging = False
        self.restart_fresh = False
        self.pending_native = False
        self.last_mouse = None
        self.checkpoint(previous)
        self.apply()
        # An explicit reset must remain empty when Painting is subsequently stopped.
        self.original_selection = [(elem, elem.select)
                                   for seq in (self.picker.bm.verts, self.picker.bm.edges, self.picker.bm.faces)
                                   for elem in seq]

    def checkpoint(self, previous):
        if previous != self.groups:
            self.undo.append(set(previous))
            del self.undo[:-64]
            self.redo.clear()

    def brush(self, mouse, subtract):
        start = self.last_mouse if self.last_mouse is not None else mouse
        count = max(1, int(math.ceil((mouse-start).length/6)))
        touched = set()
        for i in range(1, count+1):
            touched.update(self.picker.hit(start.lerp(mouse, i/count), self.painter.scene.snap_uv_easy_through))
        previous = set(self.groups)
        self.groups = self.groups-touched if subtract else self.groups|touched
        self.hover = self.picker.hit(mouse, self.painter.scene.snap_uv_easy_through)
        self.subtract = subtract
        self.last_mouse = mouse.copy()
        if previous != self.groups:
            self.apply()
        self.painter.area.tag_redraw()


def merge_paint_steps(steps):
    if not steps:
        return None
    first, last = steps[0], steps[-1]
    before, after = {}, {}
    for step in steps:
        for key, value in step['before'].items():
            before.setdefault(key, value)
        after.update(step['after'])
    return dict(layer=first['layer'], topology=first['topology'], before=before, after=after,
                records_before=first['records_before'], records_after=last['records_after'])


def draw_easy_selection_overlay():
    painter = active_gradient_painter
    context = bpy.context
    if (painter is None or not context.scene.snap_uv_painting_active
            or not context.scene.snap_uv_easy_mode
            or context.area != painter.area or context.edit_object != painter.obj):
        return
    stage = painter.easy_selection or getattr(painter, 'shift_hover_preview', None)
    if stage is None and context.scene.snap_uv_easy_variant == 'AUTO':
        # Display native/current selection without creating a selection brush,
        # changing selection, or constructing another ray-casting BVH.
        bm = bmesh.from_edit_mesh(painter.obj.data)
        faces = tuple(f for f in bm.faces if f.select and not f.hide)
        if not faces:
            return
        stage = getattr(painter, 'automatic_overlay', None)
        if stage is None or stage.faces != faces or stage.picker.bm != bm:
            stage = SimpleNamespace(
                faces=faces, picker=SimpleNamespace(bm=bm, components=[[f] for f in faces]),
                groups=set(range(len(faces))), hover=set(), subtract=False, confirmed=True,
                overlay_key=None, overlay_batches=[])
            painter.automatic_overlay = stage
    if stage is None or not stage.picker.bm.is_valid:
        return
    import gpu
    from gpu_extras.batch import batch_for_shader
    matrix = painter.obj.matrix_world
    view_projection = context.region_data.perspective_matrix
    key = (tuple(sorted(stage.groups)), tuple(sorted(stage.hover)), stage.subtract, stage.confirmed,
           tuple(v for row in matrix for v in row),
           tuple(v for row in view_projection for v in row))
    shader = gpu.shader.from_builtin('UNIFORM_COLOR')
    if key != stage.overlay_key:
        stage.overlay_batches = []
        inverse_projection = view_projection.inverted_safe()
        biased_positions = {}

        def overlay_position(vert):
            if vert not in biased_positions:
                world = matrix @ vert.co
                clip = view_projection @ world.to_4d()
                # Bias only depth, preserving screen coordinates in both view types.
                # Depth testing still hides the overlay behind other surfaces.
                if clip.w > 1e-8 and clip.z > -clip.w:
                    clip.z = max(-clip.w + 1e-7 * clip.w, clip.z - 2e-5 * clip.w)
                    biased = inverse_projection @ clip
                    if abs(biased.w) > 1e-8:
                        world = biased.to_3d() / biased.w
                biased_positions[vert] = world
            return biased_positions[vert]

        hover_faces = {f for g in stage.hover for f in stage.picker.components[g] if f.is_valid and not f.hide}
        hover_color = (0.95, 0.35, 0.4) if stage.subtract else (1.0, 0.75, 0.25)
        selected_faces = {f for g in stage.groups for f in stage.picker.components[g] if f.is_valid and not f.hide}
        triangles = stage.picker.bm.calc_loop_triangles() if selected_faces or hover_faces else []
        for faces, color in ((selected_faces - hover_faces, (1.0, 0.75, 0.25, 0.08)),
                             (hover_faces, (*hover_color, 0.08))):
            positions = [overlay_position(loop.vert) for tri in triangles if tri[0].face in faces for loop in tri]
            if positions:
                stage.overlay_batches.append((batch_for_shader(shader, 'TRIS', {'pos': positions}), color))
        for groups, color in ((stage.groups, (1.0, 0.75, 0.25, 0.85)),
                              (stage.hover, (*hover_color, 0.85))):
            faces = {f for g in groups for f in stage.picker.components[g] if f.is_valid and not f.hide}
            edges = {edge for face in faces for edge in face.edges
                     if edge.seam or sum(f in faces for f in edge.link_faces) != 2}
            if not edges:
                edges = {edge for face in faces for edge in face.edges}
            borders = [overlay_position(vert) for edge in edges for vert in edge.verts]
            if borders:
                stage.overlay_batches.append((batch_for_shader(shader, 'LINES', {'pos': borders}), color))
        stage.overlay_key = key
    gpu.state.blend_set('ALPHA')
    gpu.state.depth_test_set('LESS_EQUAL')
    gpu.state.depth_mask_set(False)
    gpu.state.line_width_set(1.0)
    try:
        shader.bind()
        for batch, color in stage.overlay_batches:
            shader.uniform_float('color', color)
            batch.draw(shader)
    finally:
        gpu.state.line_width_set(1.0)
        gpu.state.depth_mask_set(True)
        gpu.state.depth_test_set('NONE')
        gpu.state.blend_set('NONE')



class EasyMeshPicker:
    def __init__(self, painter):
        self.painter = painter
        self.bm = bmesh.from_edit_mesh(painter.obj.data)
        self.bm.faces.index_update()
        self.bm.verts.index_update()
        self.uv = self.bm.loops.layers.uv.verify()
        self.faces = [f for f in self.bm.faces if not f.hide]
        self.components, self.component_for = [], {}
        for face in self.faces:
            if face in self.component_for:
                continue
            index, pending, group = len(self.components), [face], []
            self.component_for[face] = index
            while pending:
                current = pending.pop()
                group.append(current)
                for edge in current.edges:
                    if edge.seam or edge.hide:
                        continue
                    for neighbor in edge.link_faces:
                        if not neighbor.hide and neighbor not in self.component_for:
                            self.component_for[neighbor] = index
                            pending.append(neighbor)
            self.components.append(group)
        self.bvh = BVHTree.FromPolygons(
            [v.co.copy() for v in self.bm.verts],
            [[v.index for v in f.verts] for f in self.faces], all_triangles=False) if self.faces else None
        self.inverse = painter.obj.matrix_world.inverted_safe()
        self.depsgraph = bpy.context.evaluated_depsgraph_get()
        self.hit_cache = {}
        self.view_key = None
        self.epsilon = max(1e-7, max((v.co.length for v in self.bm.verts), default=1)*1e-7)

    def hit(self, point, through=False):
        if self.bvh is None:
            return set()
        p = self.painter
        view_key = (p.region.width, p.region.height,
                    tuple(v for row in p.rv3d.perspective_matrix for v in row))
        if view_key != self.view_key:
            self.hit_cache.clear()
            self.view_key = view_key
        cache_key = (round(point.x/2), round(point.y/2), through)
        if cache_key in self.hit_cache:
            return set(self.hit_cache[cache_key])
        world_origin = view3d_utils.region_2d_to_origin_3d(p.region, p.rv3d, point)
        world_ray = view3d_utils.region_2d_to_vector_3d(p.region, p.rv3d, point)
        origin = self.inverse @ world_origin
        ray = (self.inverse.to_3x3() @ world_ray).normalized()
        groups = set()
        for _ in range(128 if through else 1):
            location, _normal, index, _distance = self.bvh.ray_cast(origin, ray)
            if location is None:
                break
            if not through:
                # The active edit mesh has its own BVH; other visible objects may occlude it.
                hit, pos, _n, _i, obj, _m = p.scene.ray_cast(
                    self.depsgraph, world_origin, world_ray)
                if hit and obj is not None and obj.original != p.obj:
                    own_distance = (p.obj.matrix_world @ location-world_origin).length
                    if (pos-world_origin).length < own_distance-1e-5:
                        break
            groups.add(self.component_for[self.faces[index]])
            origin = location+ray*self.epsilon
        if len(self.hit_cache) >= 8192:
            self.hit_cache.clear()
        self.hit_cache[cache_key] = set(groups)
        return groups

    def select(self, groups):
        chosen = {f for group in groups for f in self.components[group]}
        for face in self.bm.faces:
            face.select_set(False)
        for edge in self.bm.edges:
            edge.select_set(False)
        for vert in self.bm.verts:
            vert.select_set(False)
        for face in chosen:
            face.select_set(True)
        # face.select_set selects its edges/vertices too; flushing from vertex
        # mode would also select neighbors across a seam through shared vertices.
        return [(loop, loop[self.uv].uv.copy()) for face in self.faces if face in chosen for loop in face.loops]

    def path_groups(self, points, closed=False):
        if not points:
            return set()
        samples = []
        for a, b in zip(points, points[1:]):
            length = (b-a).length
            count = max(1, int(math.ceil(length/8)))
            side = Vector((-(b-a).y, (b-a).x)).normalized()*3 if length > 1e-6 else Vector((0,0))
            for i in range(count):
                sample = a.lerp(b, i/count)
                samples.extend((sample, sample+side, sample-side))
        samples.append(points[-1])
        if closed and len(points) > 3:
            # Scan the circle/ellipse interior too, so a contour around a piece picks it.
            lo = Vector((min(p.x for p in points), min(p.y for p in points)))
            hi = Vector((max(p.x for p in points), max(p.y for p in points)))
            step = max(20.0, math.sqrt(max(1, (hi.x-lo.x)*(hi.y-lo.y))/256))
            y = lo.y+step*0.5
            while y < hi.y:
                crossings = sorted(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y)
                                   for a,b in zip(points,points[1:]) if (a.y>y)!=(b.y>y))
                for left,right in zip(crossings[::2],crossings[1::2]):
                    x = left+min(step*0.5,(right-left)*0.5)
                    while x < right:
                        samples.append(Vector((x,y)))
                        x += step
                y += step
        groups, seen = set(), set()
        for sample in samples:
            if not (0 <= sample.x < self.painter.region.width and 0 <= sample.y < self.painter.region.height):
                continue
            key = (round(sample.x/2), round(sample.y/2))
            if key in seen:
                continue
            seen.add(key)
            groups.update(self.hit(sample, self.painter.scene.snap_uv_easy_through))
        return groups


class EasyStroke:
    def __init__(self, painter, fixed_faces=None):
        self.painter = painter
        self.picker = EasyMeshPicker(painter)
        self.fixed_groups = ({self.picker.component_for[f] for f in fixed_faces if f in self.picker.component_for}
                             if fixed_faces is not None else None)
        self.originals = {}
        self.selection = [(elem, elem.select) for seq in (self.picker.bm.verts, self.picker.bm.edges, self.picker.bm.faces) for elem in seq]
        self.current = []
        self.current_groups = None
        self.last_preview = 0.0

    def restore(self, selection=False, update=True):
        if not self.picker.bm.is_valid or self.painter.obj.mode != 'EDIT':
            return
        for loop, value in self.originals.items():
            if loop.is_valid:
                loop[self.picker.uv].uv = value
        if selection:
            for elem, selected in self.selection:
                if elem.is_valid:
                    elem.select = selected
        if update:
            bmesh.update_edit_mesh(self.painter.obj.data, loop_triangles=False, destructive=False)
            self.painter.obj.data.update()

    def resolve(self, points, closed=False):
        groups = self.fixed_groups if self.fixed_groups is not None else self.picker.path_groups(points, closed)
        if groups == self.current_groups:
            return self.current
        self.restore(update=False)
        self.current_groups = set(groups)
        selected = self.picker.select(groups)
        for loop, value in selected:
            self.originals.setdefault(loop, value)
        self.current = [(loop, self.originals[loop].copy()) for loop, _ in selected]
        return self.current

    def selection_data(self, points):
        self.resolve(points)
        return self.painter.obj, self.picker.bm, self.picker.uv, self.current



# --- Persistent, editable viewport gradients ---

GRADIENT_RECORDS_KEY = "pigmi_editable_gradients_v1"
active_gradient_painter = None


def gradient_records(mesh):
    source = mesh.get(GRADIENT_RECORDS_KEY, "[]")
    painter = active_gradient_painter
    cache = getattr(painter, 'records_cache', None)
    if cache is not None and cache[0] == mesh and cache[1] == source:
        return cache[2]
    try:
        records = json.loads(source)
    except (ValueError, TypeError):
        records = []
    if painter is not None:
        painter.records_cache = (mesh, source, records)
    return records


def store_gradient_records(mesh, records):
    source = json.dumps(records, separators=(',', ':'))
    mesh[GRADIENT_RECORDS_KEY] = source
    if active_gradient_painter is not None:
        active_gradient_painter.records_cache = (mesh, source, records)


def trim_paint_history(painter):
    # Each undo entry contains the mesh's gradient metadata, which grows with
    # painted pieces. Bound memory as well as the number of undo gestures.
    total = 0
    keep = 0
    for step in reversed(painter.paint_undo):
        total += len(step['records_before']) + len(step['records_after'])
        total += (len(step['before']) + len(step['after'])) * 160
        if keep and total > 32 * 1024 * 1024:
            break
        keep += 1
        if keep == 64:
            break
    if keep:
        del painter.paint_undo[:-keep]


def gradient_loop_keys(loops):
    return [f"{loop.face.index}:{list(loop.face.loops).index(loop)}:{loop.vert.index}"
            for loop, _ in loops]


def gradient_selection(context):
    obj = context.edit_object
    if obj is None or obj.type != 'MESH' or obj.mode != 'EDIT':
        return None
    bm = bmesh.from_edit_mesh(obj.data)
    bm.faces.index_update()
    bm.verts.index_update()
    uv = bm.loops.layers.uv.active
    if uv is None:
        return None
    loops = selected_face_loop_data(bm, uv, context.tool_settings)
    return (obj, bm, uv, loops) if loops else None


def matching_gradient(obj, uv, loops):
    if not loops:
        return None
    keys = gradient_loop_keys(loops)
    for record in reversed(gradient_records(obj.data)):
        saved = record.get("uvs", {})
        if record.get("layer") != uv.name or not all(key in saved for key in keys):
            continue
        # UV edits and most topology edits invalidate the association instead of
        # resurrecting a stroke that no longer describes this selection.
        if all((loop[uv].uv - Vector(saved[key])).length < 1e-5
               for key, (loop, _) in zip(keys, loops)):
            return record
    return None


def remember_paint_step(obj, uv, loops, records_before):
    painter = active_gradient_painter
    if painter is None or painter.obj != obj:
        return
    keys = gradient_loop_keys(loops)
    before = {key: list(value) for key, (_loop, value) in zip(keys, loops)}
    after = {key: list(loop[uv].uv) for key, (loop, _value) in zip(keys, loops)}
    records_after = obj.data.get(GRADIENT_RECORDS_KEY, '[]')
    if before == after and records_before == records_after:
        return
    if painter.easy_selection is not None and painter.easy_selection.confirmed:
        painter.easy_selection.painted = True
    bm = bmesh.from_edit_mesh(obj.data)
    step = dict(layer=uv.name, before=before, after=after,
                records_before=records_before, records_after=records_after,
                topology=(len(bm.verts), len(bm.edges), len(bm.faces)))
    if painter.paint_batch is not None:
        painter.paint_batch.append(step)
        return
    painter.paint_undo.append(step)
    trim_paint_history(painter)
    painter.paint_redo.clear()


def save_gradient_record(obj, uv, loops, record):
    records_before = obj.data.get(GRADIENT_RECORDS_KEY, '[]')
    # Cached saved nodes must not share lists with the live draggable editor.
    record = json.loads(json.dumps(record))
    record["layer"] = uv.name
    record["uvs"] = {key: list(loop[uv].uv)
                     for key, (loop, _) in zip(gradient_loop_keys(loops), loops)}
    records = gradient_records(obj.data)
    touched = set(record["uvs"])
    kept = []
    for old in records:
        if old.get("layer") == uv.name:
            old = dict(old, uvs={k: v for k, v in old.get("uvs", {}).items() if k not in touched})
        if old.get("uvs"):
            kept.append(old)
    store_gradient_records(obj.data, kept + [record])
    remember_paint_step(obj, uv, loops, records_before)


def remap_saved_gradient(obj, uv, loops, record, bounds, direction, colors):
    """Move existing UV progress to a new cell without reprojecting the stroke."""
    old_bounds = record['bounds']
    old_direction = record['direction']
    axis = 0 if old_direction in {'LEFT_TO_RIGHT', 'RIGHT_TO_LEFT'} else 1
    extent = old_bounds[axis+2]
    if extent <= 1e-12:
        return False
    for loop, old_uv in loops:
        progress = (old_uv[axis]-old_bounds[axis]) / extent
        if old_direction in {'RIGHT_TO_LEFT', 'TOP_TO_BOTTOM'}:
            progress = 1.0-progress
        set_loop_gradient_uv(loop, uv, progress, *bounds, direction)
    updated = dict(record, bounds=list(bounds), direction=direction, colors=colors)
    save_gradient_record(obj, uv, loops, updated)
    return True


def forget_gradient_records(obj, uv, loops):
    records_before = obj.data.get(GRADIENT_RECORDS_KEY, '[]')
    bm = bmesh.from_edit_mesh(obj.data)
    bm.faces.index_update()
    bm.verts.index_update()
    touched = set(gradient_loop_keys(loops))
    records = gradient_records(obj.data)
    if not records:
        remember_paint_step(obj, uv, loops, records_before)
        return
    kept = []
    for record in records:
        if record.get('layer') == uv.name:
            record = dict(record, uvs={k: v for k, v in record.get('uvs', {}).items() if k not in touched})
        if record.get('uvs'):
            kept.append(record)
    store_gradient_records(obj.data, kept)
    remember_paint_step(obj, uv, loops, records_before)


def gradient_local_path(obj, loops, screen_points, region, rv3d):
    depth = (sum((obj.matrix_world @ loop.vert.co for loop, _ in loops), Vector()) / len(loops)
             if loops else obj.matrix_world @ (sum((Vector(p) for p in obj.bound_box), Vector()) / 8))
    inverse = obj.matrix_world.inverted_safe()
    return [list(inverse @ view3d_utils.region_2d_to_location_3d(region, rv3d, p, depth))
            for p in screen_points]


def bezier_nodes(points):
    nodes = []
    for i, p in enumerate(points):
        tangent = (points[min(i + 1, len(points) - 1)] - points[max(0, i - 1)]) / 6.0
        nodes.append([list(p - tangent), list(p), list(p + tangent)])
    return nodes


def bezier_path(nodes):
    points = []
    for a, b in zip(nodes, nodes[1:]):
        p0, p1, p2, p3 = Vector(a[1]), Vector(a[2]), Vector(b[0]), Vector(b[1])
        for step in range(24):
            t = step / 24.0
            points.append((1-t)**3*p0 + 3*(1-t)**2*t*p1 + 3*(1-t)*t*t*p2 + t**3*p3)
    if nodes:
        points.append(Vector(nodes[-1][1]))
    return points


def gradient_colored_polyline(points, colors):
    """Include every palette color stop, even when the path has only two points."""
    if not points:
        return [], []
    colors = colors or [(0.25, 0.65, 1, 1)]
    distances = [0.0]
    for a, b in zip(points, points[1:]):
        distances.append(distances[-1] + (b-a).length)
    total = distances[-1]
    def color_at(distance):
        position = distance / max(total, 1e-9) * (len(colors)-1)
        index = min(int(position), len(colors)-1)
        weight = position-index
        a, b = colors[index], colors[min(index+1, len(colors)-1)]
        return tuple(x+(y-x)*weight for x, y in zip(a, b))
    sampled, sampled_colors = [points[0]], [colors[0]]
    stop = 1
    for i, (a, b) in enumerate(zip(points, points[1:])):
        start, end = distances[i], distances[i+1]
        while stop < len(colors)-1 and total > 1e-9:
            distance = total * stop / (len(colors)-1)
            if distance >= end:
                break
            if distance > start and end-start > 1e-9:
                sampled.append(a.lerp(b, (distance-start)/(end-start)))
                sampled_colors.append(colors[stop])
            stop += 1
        sampled.append(b)
        sampled_colors.append(color_at(end))
    return sampled, sampled_colors


def draw_editable_gradient_overlay():
    context = bpy.context
    painter = active_gradient_painter
    if painter is None or not context.scene.snap_uv_painting_active or painter.drawing:
        return
    editor = painter.gradient_editor
    if editor is None or (not context.scene.snap_uv_show_gradients and not editor.building):
        return
    if context.area != editor.area or context.edit_object != editor.obj:
        return
    record, obj = editor.record, editor.obj
    region = context.region
    rv3d = getattr(context.space_data, 'region_3d', None)
    if region is None or rv3d is None:
        return
    def project(point):
        return view3d_utils.location_3d_to_region_2d(region, rv3d, obj.matrix_world @ Vector(point))
    points = [project(p) for p in record['path']]
    if not points or any(p is None for p in points):
        return
    import gpu
    from gpu_extras.batch import batch_for_shader
    shader = gpu.shader.from_builtin('UNIFORM_COLOR')
    gpu.state.blend_set('ALPHA')
    try:
        batch = build_screen_polyline_batch(batch_for_shader, points, 12.0)
        if batch:
            shader.bind()
            shader.uniform_float('color', (1, 1, 1, 0.85))
            batch.draw(shader)
        colors = deserialize_gradient_colors(record.get('colors', ''))
        colored_points, point_colors = gradient_colored_polyline(points, colors)
        batch = build_screen_polyline_batch(batch_for_shader, colored_points, 7.0,
                                            gradient=True, point_colors=point_colors)
        if batch:
            color_shader = gpu.shader.from_builtin('SMOOTH_COLOR')
            color_shader.bind()
            batch.draw(color_shader)
        nodes = record.get('nodes', []) if editor else []
        if record.get('kind') == 'CIRCLE' and len(nodes) >= 2:
            guide = [p for node in nodes[1:] for p in (project(nodes[0][1]), project(node[1]))]
            if all(p is not None for p in guide):
                batch = batch_for_shader(shader, 'LINES', {'pos': guide})
                shader.bind()
                shader.uniform_float('color', (1, 1, 1, 0.45))
                batch.draw(shader)
        for node in nodes:
            handles = [project(p) for p in node]
            if any(p is None for p in handles):
                continue
            if record.get('kind') == 'BEZIER':
                batch = batch_for_shader(shader, 'LINE_STRIP', {'pos': handles})
                shader.bind()
                shader.uniform_float('color', (1, 0.65, 0.15, 1))
                batch.draw(shader)
                for p in (handles[0], handles[2]):
                    draw_path_endpoint(batch_for_shader, shader, p, 5, (1, 0.65, 0.15, 1))
            draw_path_endpoint(batch_for_shader, shader, handles[1], 7, (1, 1, 1, 1))
        move_control = editor.move_handle_screen()
        if move_control is not None:
            draw_path_endpoint(batch_for_shader, shader, move_control, 9, (0.04, 0.13, 0.16, 1))
            draw_path_endpoint(batch_for_shader, shader, move_control, 6, (0.15, 0.85, 1.0, 1))
            cross = [move_control+Vector(offset) for offset in ((-4, 0), (4, 0), (0, -4), (0, 4))]
            batch = batch_for_shader(shader, 'LINES', {'pos': cross})
            shader.bind()
            shader.uniform_float('color', (0, 0.15, 0.2, 1))
            batch.draw(shader)
        rotation = editor.rotation_handle_screen()
        if rotation is not None:
            rim, control = rotation
            batch = batch_for_shader(shader, 'LINES', {'pos': [rim, control]})
            shader.bind()
            shader.uniform_float('color', (0.7, 0.4, 1.0, 1))
            batch.draw(shader)
            draw_path_endpoint(batch_for_shader, shader, control, 7, (0.7, 0.4, 1.0, 1))
        active_control = editor.drag if editor.drag is not None else editor.hover
        if active_control is not None:
            index, handle = active_control
            if index == -2:
                point = move_control
            elif index == -1:
                point = rotation[1] if rotation is not None else None
            else:
                point = project(nodes[index][handle])
            if point is not None:
                draw_path_endpoint(batch_for_shader, shader, point, 12, (0.08, 0.08, 0.08, 1))
                draw_path_endpoint(batch_for_shader, shader, point, 10, (1.0, 0.85, 0.1, 1))
                draw_path_endpoint(batch_for_shader, shader, point, 5, (1, 1, 1, 1))
        if not nodes:
            for p in (points[0], points[-1]):
                draw_path_endpoint(batch_for_shader, shader, p, 7, (1, 1, 1, 1))
    finally:
        gpu.state.blend_set('NONE')


class GradientSnapCache:
    """Nearby screen targets, with full face occlusion and surface fallback."""

    def __init__(self, obj, region, rv3d):
        self.obj, self.region, self.rv3d = obj, region, rv3d
        self.key = None
        bm = bmesh.from_edit_mesh(obj.data)
        bm.verts.index_update()
        vertices = [v.co.copy() for v in bm.verts]
        faces = [[v.index for v in f.verts] for f in bm.faces if not f.hide]
        self.bvh = BVHTree.FromPolygons(vertices, faces, all_triangles=False) if faces else None
        self.candidates = [(v.co.copy(), 'Vertex') for v in bm.verts if not v.hide]
        self.candidates.extend(((e.verts[0].co+e.verts[1].co)*0.5, 'Edge midpoint')
                               for e in bm.edges if not e.hide and not any(v.hide for v in e.verts))
        self.candidates.extend((f.calc_center_median(), 'Face center') for f in bm.faces if not f.hide)
        extent = max(((v - vertices[0]).length for v in vertices), default=1.0)
        self.epsilon = max(1e-7, extent * 1e-6)

    def ray(self, screen):
        origin = self.inverse @ view3d_utils.region_2d_to_origin_3d(self.region, self.rv3d, screen)
        direction = (self.inverse.to_3x3() @ view3d_utils.region_2d_to_vector_3d(
            self.region, self.rv3d, screen)).normalized()
        return origin, direction

    def visible(self, index):
        if index not in self.visibility:
            origin, direction = self.ray(self.screen[index])
            distance = (self.local[index] - origin).dot(direction)
            hit = self.bvh.ray_cast(origin, direction, max(0.0, distance-self.epsilon))[0] if self.bvh else None
            self.visibility[index] = distance >= 0 and hit is None
        return self.visibility[index]

    def find(self, mouse):
        key = (self.region.width, self.region.height,
               tuple(v for row in self.rv3d.perspective_matrix for v in row),
               tuple(v for row in self.obj.matrix_world for v in row))
        if key != self.key:
            self.inverse = self.obj.matrix_world.inverted_safe()
            self.local, self.labels, self.screen = [], [], []
            self.buckets, self.visibility = {}, {}
            for point, label in self.candidates:
                projected = view3d_utils.location_3d_to_region_2d(
                    self.region, self.rv3d, self.obj.matrix_world @ point)
                if projected is not None:
                    index = len(self.local)
                    self.local.append(point)
                    self.labels.append(label)
                    self.screen.append(projected)
                    bucket = (math.floor(projected.x/14), math.floor(projected.y/14))
                    self.buckets.setdefault(bucket, []).append(index)
            self.key = key
        bx, by = math.floor(mouse.x/14), math.floor(mouse.y/14)
        nearby = []
        for x in range(bx-1, bx+2):
            for y in range(by-1, by+2):
                for index in self.buckets.get((x, y), ()):
                    distance = (self.screen[index]-mouse).length_squared
                    if distance <= 14.0**2:
                        nearby.append((distance, index))
        for _distance, index in sorted(nearby):
            if self.visible(index):
                return self.local[index].copy(), self.labels[index]
        if self.bvh is not None:
            origin, direction = self.ray(mouse)
            hit = self.bvh.ray_cast(origin, direction)[0]
            if hit is not None:
                return hit, 'Face surface'
        return None


def gradient_snap_point(painter, mouse, fallback):
    painter.gradient_snap_target = None
    if not painter.scene.snap_uv_gradient_snap:
        return fallback
    cache = painter.gradient_snap_cache
    if cache is None or cache.region != painter.region or cache.rv3d != painter.rv3d:
        cache = GradientSnapCache(painter.obj, painter.region, painter.rv3d)
        painter.gradient_snap_cache = cache
    result = cache.find(mouse)
    painter.gradient_snap_target = result
    return result[0] if result is not None else fallback


def draw_gradient_snap_target():
    painter = active_gradient_painter
    context = bpy.context
    if (painter is None or not context.scene.snap_uv_painting_active
            or not context.scene.snap_uv_gradient_snap or context.area != painter.area
            or context.edit_object != painter.obj or painter.gradient_snap_target is None):
        return
    point, label = painter.gradient_snap_target
    screen = view3d_utils.location_3d_to_region_2d(
        painter.region, painter.rv3d, painter.obj.matrix_world @ point)
    if screen is None:
        return
    import gpu
    import blf
    from gpu_extras.batch import batch_for_shader
    shader = gpu.shader.from_builtin('UNIFORM_COLOR')
    gpu.state.blend_set('ALPHA')
    try:
        draw_path_endpoint(batch_for_shader, shader, screen, 7, (0.05, 0.12, 0.15, 1))
        draw_path_endpoint(batch_for_shader, shader, screen, 5, (0.1, 1.0, 0.85, 1))
        blf.position(0, screen.x+14, screen.y+14, 0)
        blf.size(0, 12)
        blf.color(0, 0.1, 1.0, 0.85, 1)
        blf.draw(0, label)
    finally:
        gpu.state.blend_set('NONE')


def ellipse_point_phase(a, b, delta):
    aa, ab, bb = a.dot(a), a.dot(b), b.dot(b)
    determinant = aa*bb-ab*ab
    if determinant <= 1e-12*max(aa*bb, 1e-20):
        return None
    da, db = delta.dot(a), delta.dot(b)
    x, y = (da*bb-db*ab)/determinant, (db*aa-da*ab)/determinant
    return math.atan2(y, x) if x*x+y*y > 1e-12 else None


def ellipse_path(center, first_axis, second_axis, segments=96, phase=0.0):
    a, b = first_axis-center, second_axis-center
    points = [center + a*math.cos(phase+math.tau*i/segments) + b*math.sin(phase+math.tau*i/segments)
              for i in range(segments)]
    points.append(points[0].copy())
    return points


def circle_path(center, rim, normal, segments=96):
    axis = rim-center
    radius = axis.length
    if radius <= 1e-8:
        return [center.copy()]
    tangent = normal.cross(axis)
    if tangent.length <= 1e-8:
        fallback = Vector((1, 0, 0)) if abs(axis.normalized().x) < 0.9 else Vector((0, 1, 0))
        tangent = fallback.cross(axis)
    tangent = tangent.normalized()*radius
    points = [center + axis*math.cos(math.tau*i/segments) + tangent*math.sin(math.tau*i/segments)
              for i in range(segments)]
    points.append(points[0].copy())
    return points


class PaletteGradientEdit:
    """Transient handles owned by the existing painting operator."""

    def __init__(self, painter, selection, record, building=False):
        self.painter = painter
        self.obj, self.bm, self.uv, self.loops = selection
        self.area, self.region, self.rv3d = painter.area, painter.region, painter.rv3d
        self.record = json.loads(json.dumps(record))
        self.building = building
        self.drag = None
        self.hover = None
        self.dirty = False
        self.snapshot = None
        self.projection_cache = None
        self.projection_key = None
        if self.record['kind'] == 'CIRCLE' and len(self.record.get('nodes', [])) == 2:
            # Older circles had one radius; recover the perpendicular axis from the saved path.
            point = self.record['path'][(len(self.record['path'])-1)//4]
            self.record['nodes'].append([point[:], point[:], point[:]])
        if not building and not self.record.get('nodes'):
            path = [Vector(p) for p in self.record['path']]
            if self.record['kind'] == 'STRAIGHT':
                anchors = [path[0], path[-1]]
            else:
                # Preserve the saved stroke until the user moves a control.
                count = min(12, len(path))
                anchors = [path[round(i*(len(path)-1)/(count-1))] for i in range(count)]
                self.record['kind'] = 'BEZIER'
            self.record['nodes'] = bezier_nodes(anchors)

    def control_center(self):
        if self.record['kind'] == 'CIRCLE':
            return Vector(self.record['nodes'][0][1])
        points = [Vector(p) for p in self.record['path']]
        return sum(points, Vector()) / max(1, len(points))

    def move_handle_screen(self):
        if self.building:
            return None
        return view3d_utils.location_3d_to_region_2d(
            self.region, self.rv3d, self.obj.matrix_world @ self.control_center())

    def transform_whole_path(self, mouse, rotate=False):
        matrix, inverse = self.obj.matrix_world, self.obj.matrix_world.inverted_safe()
        center = matrix @ self.transform_center
        if rotate:
            screen_center = view3d_utils.location_3d_to_region_2d(self.region, self.rv3d, center)
            if screen_center is None:
                return
            start, current = self.transform_mouse-screen_center, mouse-screen_center
            if start.length < 1e-6 or current.length < 1e-6:
                return
            angle = math.atan2(current.y, current.x)-math.atan2(start.y, start.x)
            rotation = Quaternion(self.rv3d.view_rotation @ Vector((0, 0, 1)), angle)
            def transform(p):
                return inverse @ (center + rotation @ (matrix @ Vector(p)-center))
            self.painter.gradient_snap_target = None
        else:
            world = view3d_utils.region_2d_to_location_3d(self.region, self.rv3d, mouse, center)
            initial = view3d_utils.region_2d_to_location_3d(self.region, self.rv3d, self.transform_mouse, center)
            target = inverse @ (center+world-initial)
            target = gradient_snap_point(self.painter, mouse, target)
            delta = target-self.transform_center
            def transform(p):
                return Vector(p)+delta
        self.record['nodes'] = [[list(transform(p)) for p in node] for node in self.snapshot['nodes']]
        # Transform the saved polyline directly; moving a freehand stroke must
        # not silently replace its shape with the editable Bezier approximation.
        self.update_uvs(path_override=[transform(p) for p in self.snapshot['path']])

    def rotation_handle_screen(self):
        if self.building:
            return None
        center = self.control_center()
        if self.record['kind'] == 'CIRCLE':
            nodes = self.record['nodes']
            phase = self.record.get('circle_phase', 0.0)
            start = center + (Vector(nodes[1][1])-center)*math.cos(phase) + (Vector(nodes[2][1])-center)*math.sin(phase)
        else:
            start = Vector(self.record['path'][-1])
            if (start-center).length < 1e-6:
                start = max((Vector(p) for p in self.record['path']), key=lambda p: (p-center).length)
        def project(p):
            return view3d_utils.location_3d_to_region_2d(self.region, self.rv3d, self.obj.matrix_world @ p)
        c, rim = project(center), project(start)
        if c is None or rim is None or (rim-c).length < 1e-6:
            return None
        return rim, rim+(rim-c).normalized()*26.0

    def rotate_gradient(self, mouse):
        nodes = self.record['nodes']
        center = Vector(nodes[0][1])
        a, b = Vector(nodes[1][1])-center, Vector(nodes[2][1])-center
        matrix = self.obj.matrix_world
        world_center = matrix @ center
        normal = (matrix.to_3x3() @ a).cross(matrix.to_3x3() @ b)
        if normal.length <= 1e-10:
            return
        normal.normalize()
        origin = view3d_utils.region_2d_to_origin_3d(self.region, self.rv3d, mouse)
        ray = view3d_utils.region_2d_to_vector_3d(self.region, self.rv3d, mouse)
        denominator = ray.dot(normal)
        if abs(denominator) < 1e-8:
            return
        world = origin + ray*((world_center-origin).dot(normal)/denominator)
        point = matrix.inverted_safe() @ world
        point = gradient_snap_point(self.painter, mouse, point)
        phase = ellipse_point_phase(a, b, point-center)
        if phase is not None:
            self.record['circle_phase'] = phase
            self.update_uvs()

    def begin_drag(self, index, handle, mouse):
        self.painter.gradient_snap_cache = None
        self.painter.gradient_snap_target = None
        self.bm = bmesh.from_edit_mesh(self.obj.data)
        self.uv = self.bm.loops.layers.uv.get(self.uv.name)
        self.projection_cache = None
        self.projection_key = None
        self.painter.last_action_mode = 'PATH'
        self.snapshot = json.loads(json.dumps(self.record))
        self.transform_center = self.control_center()
        self.transform_mouse = mouse.copy()
        self.loops = [(loop, loop[self.uv].uv.copy()) for loop, _ in self.loops]
        self.drag = (index, handle)

    def update_uvs(self, path_override=None, force=False):
        nodes = self.record['nodes']
        if path_override is not None:
            path = path_override
        elif self.record['kind'] == 'CIRCLE':
            if self.building:
                matrix = self.obj.matrix_world
                inverse = matrix.inverted_safe()
                normal = inverse.to_3x3().transposed() @ Vector(self.record['circle_normal'])
                path = [inverse @ p for p in circle_path(
                    matrix @ Vector(nodes[0][1]), matrix @ Vector(nodes[1][1]), normal)]
                axis = list(path[(len(path)-1)//4])
                nodes[2] = [axis[:], axis[:], axis[:]]
            else:
                path = ellipse_path(Vector(nodes[0][1]), Vector(nodes[1][1]), Vector(nodes[2][1]),
                                    phase=self.record.get('circle_phase', 0.0))
        else:
            path = bezier_path(nodes) if self.record['kind'] == 'BEZIER' else [Vector(n[1]) for n in nodes]
        self.record['path'] = [list(p) for p in path]
        screen = [view3d_utils.location_3d_to_region_2d(self.region, self.rv3d, self.obj.matrix_world @ p) for p in path]
        if len(screen) >= 2 and all(p is not None for p in screen):
            stroke = self.painter.easy_stroke if self.building else None
            if stroke is not None:
                now = time.perf_counter()
                if not force and now-stroke.last_preview < 0.08:
                    self.area.tag_redraw()
                    return
                stroke.last_preview = now
                loops = stroke.resolve(screen, closed=self.record['kind'] == 'CIRCLE')
                if loops is not self.loops:
                    self.projection_cache = None
                self.loops = loops
            projection_key = (self.region.width, self.region.height,
                              tuple(v for row in self.rv3d.perspective_matrix for v in row),
                              tuple(v for row in self.obj.matrix_world for v in row))
            if self.projection_cache is None or projection_key != self.projection_key:
                self.projection_cache = gradient_projected_vertices(
                    self.loops, self.obj, self.region, self.rv3d)
                self.projection_key = projection_key
            apply_path_gradient_screen_uvs(self.loops, self.obj, self.uv, screen, self.region, self.rv3d,
                                           *self.record['bounds'], self.record['direction'],
                                           projected=self.projection_cache,
                                           closed=self.record['kind'] == 'CIRCLE')
            bmesh.update_edit_mesh(self.obj.data, loop_triangles=False, destructive=False)
            self.dirty = bool(self.loops)
        self.area.tag_redraw()
        self.painter.uv_area.tag_redraw()

    def finish(self, cancel=False):
        stroke = self.painter.easy_stroke if self.building else None
        if stroke is not None and not cancel:
            self.update_uvs(force=True)
            if not self.loops:
                cancel = True
        if self.obj.mode == 'EDIT' and self.bm.is_valid:
            if cancel:
                for loop, uv in self.loops:
                    if loop.is_valid:
                        loop[self.uv].uv = uv
                bmesh.update_edit_mesh(self.obj.data, loop_triangles=False, destructive=False)
                self.obj.data.update()
                if self.snapshot is not None:
                    self.record = self.snapshot
            elif self.dirty:
                save_gradient_record(self.obj, self.uv, self.loops, self.record)
                # Do not let cavity auto-preview overwrite a handle edit.
                self.painter.last_action_mode = 'PATH'
                self.painter.last_applied_selection_signature = None
        if stroke is not None:
            self.painter.end_easy_stroke(cancel=cancel)
        self.drag = None
        self.painter.gradient_snap_target = None
        self.dirty = False
        self.snapshot = None
        redraw_all_areas(bpy.context)

    def move_drag_to(self, mouse):
        self.last_drag_mouse = mouse.copy()
        nodes = self.record['nodes']
        i, handle = self.drag
        if i == -2:
            self.transform_whole_path(mouse)
            return
        if i == -1:
            if self.record['kind'] == 'CIRCLE':
                self.rotate_gradient(mouse)
            else:
                self.transform_whole_path(mouse, rotate=True)
            return
        old = Vector(nodes[i][handle])
        world = self.obj.matrix_world @ old
        new = self.obj.matrix_world.inverted_safe() @ view3d_utils.region_2d_to_location_3d(self.region, self.rv3d, mouse, world)
        new = gradient_snap_point(self.painter, mouse, new)
        if handle == 1:
            if self.record['kind'] == 'CIRCLE' and i == 0:
                for axis in range(1, len(nodes)):
                    nodes[axis] = [list(Vector(p)+new-old) for p in nodes[axis]]
            nodes[i] = [list(Vector(p)+new-old) for p in nodes[i]]
        else:
            nodes[i][handle] = list(new)
            if self.building:
                nodes[i][0] = list(2*Vector(nodes[i][1])-new)
        self.update_uvs()

    def event(self, context, event):
        if self.record['kind'] == 'CIRCLE' and event.type == 'TAB':
            self.painter.draw_modifier_held = event.value != 'RELEASE'
            return True
        if self.building and self.record['kind'] != 'CIRCLE' and event.type == 'TAB' and event.value == 'RELEASE':
            self.finish(cancel=len(self.record['nodes']) < 2)
            self.building = False
            self.painter.draw_modifier_held = False
            self.painter.sync_gradient_editor(context, force=True)
            return True
        if event.type in {'ESC', 'RIGHTMOUSE', 'WINDOW_DEACTIVATE'} and (self.drag is not None or self.building):
            self.finish(cancel=True)
            self.building = False
            self.painter.draw_modifier_held = False
            self.painter.sync_gradient_editor(context, force=True)
            return True
        mouse = Vector((event.mouse_x-self.region.x, event.mouse_y-self.region.y))
        nodes = self.record['nodes']
        if self.drag is not None:
            if event.type == 'LEFTMOUSE' and event.value == 'RELEASE':
                last_mouse = getattr(self, 'last_drag_mouse', None)
                if last_mouse is not None and (mouse-last_mouse).length > 0.001:
                    self.move_drag_to(mouse)
                if self.building and self.record['kind'] == 'CIRCLE':
                    self.finish(cancel=len(self.record['path']) < 2)
                    self.building = False
                    self.painter.sync_gradient_editor(context, force=True)
                elif self.building:
                    self.drag = None
                else:
                    self.finish()
                return True
            if event.type == 'MOUSEMOVE':
                self.move_drag_to(mouse)
            # Keep selection/topology edits out of an in-progress drag.
            return True
        if self.building and event.type == 'MOUSEMOVE':
            area, region, _rv3d = view3d_under_mouse(context, event)
            if area == self.area and region == self.region and not mouse_over_ui_region(context, event):
                gradient_snap_point(self.painter, mouse, None)
            else:
                self.painter.gradient_snap_target = None
            self.area.tag_redraw()
            return True
        if event.type != 'LEFTMOUSE' or event.value != 'PRESS':
            return self.building and event.type not in {'MIDDLEMOUSE', 'WHEELUPMOUSE', 'WHEELDOWNMOUSE', 'TIMER'}
        area, region, rv3d = view3d_under_mouse(context, event)
        if area != self.area or region != self.region:
            return self.building
        if self.building:
            point = gradient_local_path(self.obj, self.loops, [mouse], self.region, self.rv3d)[0]
            point = list(gradient_snap_point(self.painter, mouse, Vector(point)))
            self.last_drag_mouse = mouse.copy()
            if self.record['kind'] == 'CIRCLE':
                nodes.extend([[point[:], point[:], point[:]] for _ in range(3)])
                normal = self.rv3d.view_rotation @ Vector((0, 0, 1))
                self.record['circle_normal'] = list(self.obj.matrix_world.to_3x3().transposed() @ normal)
                self.drag = (1, 1)
                self.update_uvs()
                return True
            if nodes:
                delta = (Vector(point)-Vector(nodes[-1][1]))/3
                if Vector(nodes[-1][2]) == Vector(nodes[-1][1]):
                    nodes[-1][2] = list(Vector(nodes[-1][1])+delta)
                nodes.append([list(Vector(point)-delta), point, list(Vector(point)+delta)])
            else:
                nodes.append([point[:], point[:], point[:]])
            self.drag = (len(nodes)-1, 2)
            self.update_uvs()
            return True
        control = self.hit_control(context, event)
        self.set_hover(control)
        if control is not None:
            self.begin_drag(*control, mouse=mouse)
            self.last_drag_mouse = mouse.copy()
            return True
        return False

    def set_hover(self, control):
        if self.hover != control:
            self.hover = control
            self.area.tag_redraw()

    def hit_control(self, context, event):
        # Drawing modifiers and selection modifiers always keep their normal meaning.
        if (self.painter.draw_modifier_held or event.shift or event.ctrl or event.alt or event.oskey
                or not context.scene.snap_uv_show_gradients or mouse_over_ui_region(context, event)):
            return None
        area, region, _rv3d = view3d_under_mouse(context, event)
        if area != self.area or region != self.region:
            return None
        mouse = Vector((event.mouse_x-self.region.x, event.mouse_y-self.region.y))
        candidates = []
        for i, node in enumerate(self.record['nodes']):
            for h in ((1, 0, 2) if self.record['kind'] == 'BEZIER' else (1,)):
                p = view3d_utils.location_3d_to_region_2d(self.region, self.rv3d, self.obj.matrix_world @ Vector(node[h]))
                if p is not None and (p-mouse).length <= 10:
                    candidates.append(((p-mouse).length, h != 1, i, h))
        move_control = self.move_handle_screen()
        if move_control is not None and (move_control-mouse).length <= 10:
            candidates.append(((move_control-mouse).length, False, -2, 0))
        rotation = self.rotation_handle_screen()
        if rotation is not None and (rotation[1]-mouse).length <= 10:
            candidates.append(((rotation[1]-mouse).length, False, -1, 0))
        if candidates:
            _, _, i, h = min(candidates)
            return i, h
        return None


class UV_OT_clear_path_gradient(bpy.types.Operator):
    """Clear the saved path gradient overlay."""
    bl_idname = "uv.clear_path_gradient"
    bl_label = "Clear Path Gradient"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        context.scene.snap_uv_path_points = ""
        context.scene.snap_uv_path_screen_points = ""
        context.scene.snap_uv_path_colors = ""
        redraw_view3d_areas(context)
        self.report({'INFO'}, "Path gradient cleared")
        return {'FINISHED'}


class UV_OT_stop_painting(bpy.types.Operator):
    """Stop the active painting modal operator."""
    bl_idname = "uv.stop_painting"
    bl_label = "Stop Painting"
    bl_options = {'REGISTER'}

    def execute(self, context):
        context.scene.snap_uv_painting_active = False
        clear_uv_box_preview()
        context.scene.snap_uv_path_points = ""
        context.scene.snap_uv_path_screen_points = ""
        context.scene.snap_uv_path_colors = ""
        redraw_view3d_areas(context)
        redraw_all_areas(context)
        return {'FINISHED'}


class UV_OT_snap_to_grid(bpy.types.Operator):
    """Click a palette cell in the UV Editor to move selected UVs into that cell."""
    bl_idname = "uv.snap_to_grid"
    bl_label = "Snap UV to Palette cell"
    bl_options = {'REGISTER', 'UNDO'}

    path_gradient: bpy.props.BoolProperty(
        name="Path Gradient",
        default=False,
        options={'SKIP_SAVE'},
    )

    def invoke(self, context, event):
        self.override_preserve = None
        self.override_independent = None
        self.alt_modifier_held = False

        # If called from UV Editor, check for UV Sync Selection.
        if context.area.type == 'IMAGE_EDITOR':
            if not context.tool_settings.use_uv_select_sync:
                self.report({'ERROR'}, "UV Sync Selection must be enabled in the UV Editor")
                return {'CANCELLED'}
            uv_region = None
            for region in context.area.regions:
                if region.type == 'WINDOW':
                    uv_region = region
                    break
            if uv_region is None:
                self.report({'ERROR'}, "UV Editor window region not found")
                return {'CANCELLED'}
            self.uv_area   = context.area
            self.uv_region = uv_region
            self.uv_space  = context.space_data
        else:
            # If not called from UV Editor, search for one in the current screen.
            uv_area = None
            uv_region = None
            for area in context.window.screen.areas:
                if area.type == 'IMAGE_EDITOR':
                    uv_area = area
                    break
            if uv_area is None:
                self.report({'ERROR'}, "UV Editor not found in the current screen")
                return {'CANCELLED'}
            for region in uv_area.regions:
                if region.type == 'WINDOW':
                    uv_region = region
                    break
            if uv_region is None:
                self.report({'ERROR'}, "UV Editor window region not found")
                return {'CANCELLED'}
            self.uv_area   = uv_area
            self.uv_region = uv_region
            self.uv_space  = uv_area.spaces.active

        context.window_manager.modal_handler_add(self)
        if self.path_gradient:
            self.report({'INFO'}, "Click a palette cell in the UV Editor image area to apply the drawn path gradient")
        else:
            self.report({'INFO'}, "Click a target cell. Alt/Option+click projects from the 3D View first")
        return {'RUNNING_MODAL'}

    def modal(self, context, event):
        if event.type in {'LEFT_ALT', 'RIGHT_ALT'}:
            self.alt_modifier_held = event.value != 'RELEASE'
            return {'RUNNING_MODAL'}

        alt_active = alt_modifier_active(event, self.alt_modifier_held)
        if (uv_cell_mouse_event(event, self.alt_modifier_held) and
                event.value == 'PRESS'):
            # Determine local coordinates of the click in the UV Editor.
            local_x = event.mouse_x - self.uv_region.x
            local_y = event.mouse_y - self.uv_region.y
            if not (0 <= local_x <= self.uv_region.width and 0 <= local_y <= self.uv_region.height):
                self.report({'WARNING'}, "Click inside the UV Editor image area, not the 3D View")
                if self.path_gradient:
                    return {'CANCELLED'}
                return {'RUNNING_MODAL'}

            view2d = self.uv_region.view2d
            if view2d is None:
                self.report({'ERROR'}, "view2d not found in the UV Editor")
                return {'CANCELLED'}
            uv_click = view2d.region_to_view(local_x, local_y)

            # NOTE: Do not clamp uv_click to [0,1]. We allow placement that leads to cells
            # outside the texture to the right or bottom (as requested). We only prevent
            # negative indices later (clamp to min 0).

            # Retrieve parameters from the scene.
            scene = context.scene
            tex_width    = scene.snap_uv_texture_width
            tex_height   = scene.snap_uv_texture_height
            cell_width_px  = scene.snap_uv_cell_width
            cell_height_px = scene.snap_uv_cell_height

            # Compute the cell size in UV coordinates (assuming [0,1] corresponds to the full texture).
            grid_cell_width_uv  = cell_width_px / tex_width
            grid_cell_height_uv = cell_height_px / tex_height

            # Convert margin parameters from fraction to UV units.
            margin_x_uv = scene.snap_uv_margin_x * grid_cell_width_uv
            margin_y_uv = scene.snap_uv_margin_y * grid_cell_height_uv

            effective_cell_width_uv  = grid_cell_width_uv - 2 * margin_x_uv
            effective_cell_height_uv = grid_cell_height_uv - 2 * margin_y_uv

            if effective_cell_width_uv <= 0 or effective_cell_height_uv <= 0:
                self.report({'ERROR'}, "Margins are too large for the given cell size")
                return {'CANCELLED'}

            # Determine the target cell (clicked cell) index.
            # X: left -> right as usual
            target_cell_x = int(math.floor(uv_click[0] / grid_cell_width_uv))
            # Y: count rows from the TOP (top-left origin)
            target_cell_y_top = int(math.floor((1.0 - uv_click[1]) / grid_cell_height_uv))

            # Ensure indices are not negative, but DO NOT clamp maximum — allow cells to be
            # beyond the texture to the right/bottom if the math puts them there.
            target_cell_x = max(0, target_cell_x)
            target_cell_y_top = max(0, target_cell_y_top)

            # Compute target_min_u and target_min_v (bottom-left corner of effective area)
            target_min_u = target_cell_x * grid_cell_width_uv + margin_x_uv
            # For top-origin index we compute bottom v of the cell like:
            # bottom_v = 1.0 - (row_from_top + 1) * grid_cell_height_uv
            target_min_v = 1.0 - ((target_cell_y_top + 1) * grid_cell_height_uv) + margin_y_uv
            scene.snap_uv_last_cell_x = target_cell_x
            scene.snap_uv_last_cell_y_top = target_cell_y_top

            # Get the active mesh in Edit Mode.
            obj = context.edit_object
            if obj is None or obj.type != 'MESH':
                self.report({'ERROR'}, "The active object is not a mesh or not in Edit Mode")
                return {'CANCELLED'}

            bm = bmesh.from_edit_mesh(obj.data)
            uv_layer = bm.loops.layers.uv.active
            if uv_layer is None:
                uv_layer = bm.loops.layers.uv.verify()

            if (event.shift and primary_modifier(event) and
                    not alt_active and not self.path_gradient):
                if not run_uv_cell_select(
                        context, self.uv_area, self.uv_region, self.uv_space,
                        target_cell_x, target_cell_y_top,
                        grid_cell_width_uv, grid_cell_height_uv, mode='SET'):
                    self.report({'WARNING'}, "Could not select UVs in the palette cell")
                    return {'CANCELLED'}
                self.report({'INFO'}, f"Selected UVs in cell (x={target_cell_x}, y_from_top={target_cell_y_top})")
                return {'FINISHED'}

            projected_from_view = bool(alt_active and not self.path_gradient)
            if projected_from_view:
                loops_data = selected_face_loop_data(
                    bm, uv_layer, context.tool_settings)
                if not loops_data:
                    self.report({'ERROR'}, "No UVs selected")
                    return {'CANCELLED'}
                _area, view_region, rv3d = first_view3d(context)
                if not project_loops_from_view(
                        loops_data, obj, uv_layer, view_region, rv3d):
                    self.report({'ERROR'}, "Could not project the selection from the current 3D View")
                    return {'CANCELLED'}

            if primary_modifier(event) and not alt_active and not self.path_gradient:
                loops_data = selected_face_loop_data(bm, uv_layer, context.tool_settings)
                if not loops_data:
                    self.report({'ERROR'}, "No UVs selected")
                    return {'CANCELLED'}
                if not apply_cavity_gradient_uvs(
                        loops_data, obj, uv_layer,
                        target_min_u, target_min_v, effective_cell_width_uv, effective_cell_height_uv,
                        scene.snap_uv_gradient_direction, scene):
                    self.report({'ERROR'}, "Could not calculate cavity values")
                    return {'CANCELLED'}
                bmesh.update_edit_mesh(obj.data, loop_triangles=False, destructive=False)
                forget_gradient_records(obj, uv_layer, loops_data)
                self.report({'INFO'}, f"Cavity gradient mapped to cell (x={target_cell_x}, y_from_top={target_cell_y_top})")
                return {'FINISHED'}

            if event.shift and not alt_active and not self.path_gradient:
                loops_data = selected_face_loop_data(bm, uv_layer, context.tool_settings)
                if not loops_data:
                    self.report({'ERROR'}, "No UVs selected")
                    return {'CANCELLED'}
                center = loops_world_center(loops_data, obj)
                if center is None:
                    self.report({'ERROR'}, "Could not calculate mesh center")
                    return {'CANCELLED'}
                apply_distance_gradient_uvs(
                    loops_data, obj, uv_layer, center,
                    target_min_u, target_min_v, effective_cell_width_uv, effective_cell_height_uv,
                    scene.snap_uv_gradient_direction)
                bmesh.update_edit_mesh(obj.data, loop_triangles=False, destructive=False)
                forget_gradient_records(obj, uv_layer, loops_data)
                self.report({'INFO'}, f"Radial gradient mapped to cell (x={target_cell_x}, y_from_top={target_cell_y_top})")
                return {'FINISHED'}

            if self.path_gradient:
                path_points = deserialize_path_points(scene.snap_uv_path_points)
                screen_points = deserialize_screen_points(scene.snap_uv_path_screen_points)
                if len(path_points) < 2 and len(screen_points) < 2:
                    self.report({'ERROR'}, "Draw a path in the 3D View before using Path Gradient")
                    return {'CANCELLED'}
                loops_data = selected_loop_data(bm, uv_layer, context.tool_settings)
                if not loops_data:
                    self.report({'ERROR'}, "No UVs selected")
                    return {'CANCELLED'}
                (path_min_u, path_min_v,
                 path_width_uv, path_height_uv) = safe_gradient_bounds(
                    target_min_u, target_min_v,
                    effective_cell_width_uv, effective_cell_height_uv,
                    margin_x_uv, margin_y_uv, tex_width, tex_height)
                if len(screen_points) >= 2:
                    _area, view_region, rv3d = first_view3d(context)
                    if view_region is None or rv3d is None:
                        self.report({'ERROR'}, "3D View not found for screen path projection")
                        return {'CANCELLED'}
                    apply_path_gradient_screen_uvs(
                        loops_data, obj, uv_layer, screen_points, view_region, rv3d,
                        path_min_u, path_min_v, path_width_uv,
                        path_height_uv, scene.snap_uv_gradient_direction)
                else:
                    apply_path_gradient_uvs(loops_data, obj, uv_layer, path_points, path_min_u, path_min_v,
                                            path_width_uv, path_height_uv,
                                            scene.snap_uv_gradient_direction)
                bmesh.update_edit_mesh(obj.data, loop_triangles=False, destructive=False)
                bm.faces.index_update()
                bm.verts.index_update()
                local_path = (gradient_local_path(obj, loops_data, screen_points, view_region, rv3d)
                              if len(screen_points) >= 2 else
                              [list(obj.matrix_world.inverted_safe() @ point) for point in path_points])
                save_gradient_record(obj, uv_layer, loops_data, {
                    'kind': scene.snap_uv_path_style,
                    'path': local_path,
                    'bounds': [path_min_u, path_min_v, path_width_uv, path_height_uv],
                    'direction': scene.snap_uv_gradient_direction,
                    'colors': scene.snap_uv_path_colors,
                })
                self.report({'INFO'}, f"Path gradient mapped to cell (x={target_cell_x}, y_from_top={target_cell_y_top})")
                return {'FINISHED'}

            if not projected_from_view:
                bm.faces.index_update()
                bm.verts.index_update()
                selected = selected_loop_data(bm, uv_layer, context.tool_settings)
                record = matching_gradient(obj, uv_layer, selected) if selected else None
                if record is not None:
                    bounds = safe_gradient_bounds(
                        target_min_u, target_min_v, effective_cell_width_uv, effective_cell_height_uv,
                        margin_x_uv, margin_y_uv, tex_width, tex_height)
                    colors = sample_palette_gradient(
                        getattr(self.uv_space, 'image', None), target_cell_x, target_cell_y_top,
                        cell_width_px, cell_height_px, scene.snap_uv_gradient_direction)
                    if remap_saved_gradient(obj, uv_layer, selected, record, bounds,
                                            scene.snap_uv_gradient_direction, serialize_gradient_colors(colors)):
                        bmesh.update_edit_mesh(obj.data, loop_triangles=False, destructive=False)
                        obj.data.update()
                        redraw_all_areas(context)
                        return {'FINISHED'}

            # Determine effective option values.
            preserve_value = (
                False if projected_from_view else
                self.override_preserve if self.override_preserve is not None else
                scene.snap_uv_preserve)
            independent_value = self.override_independent if self.override_independent is not None else scene.snap_uv_independent

            if independent_value:
                loop_groups = get_selected_uv_islands(
                    bm, uv_layer, context.tool_settings)
            else:
                selected = selected_loop_data(
                    bm, uv_layer, context.tool_settings)
                loop_groups = [[loop for loop, _uv in selected]] if selected else []

            if not loop_groups:
                self.report({'ERROR'}, "No UVs selected")
                return {'CANCELLED'}

            for loop_group in loop_groups:
                loops_data = [
                    (loop, loop[uv_layer].uv.copy()) for loop in loop_group]
                fit_loops_to_cell(
                    loops_data, uv_layer, target_min_u, target_min_v,
                    effective_cell_width_uv, effective_cell_height_uv,
                    grid_cell_width_uv, grid_cell_height_uv,
                    margin_x_uv, margin_y_uv, preserve_value)

            bmesh.update_edit_mesh(obj.data, loop_triangles=False, destructive=False)
            forget_gradient_records(obj, uv_layer,
                                    [(loop, loop[uv_layer].uv.copy()) for group in loop_groups for loop in group])
            if projected_from_view:
                self.report({'INFO'}, f"Projected from view and moved to cell (x={target_cell_x}, y_from_top={target_cell_y_top})")
            else:
                self.report({'INFO'}, f"UVs moved to cell (x={target_cell_x}, y_from_top={target_cell_y_top})")
            return {'FINISHED'}

        elif event.type in {'RIGHTMOUSE', 'ESC'}:
            self.report({'INFO'}, "Operation cancelled")
            return {'CANCELLED'}

        return {'RUNNING_MODAL'}

# --- UI Panel ---

class UV_PT_snap_to_grid_panel(bpy.types.Panel):
    """Snap UV Panel in the 3D View"""
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Snap UV"
    bl_label = "Pigmi: UV to Palette"

    @classmethod
    def poll(cls, context):
        obj = context.edit_object or context.object
        return obj is not None and obj.type == 'MESH'

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        layout.prop(scene, "snap_uv_texture_width")
        layout.prop(scene, "snap_uv_texture_height")
        layout.prop(scene, "snap_uv_cell_width")
        layout.prop(scene, "snap_uv_cell_height")
        layout.separator()
        layout.label(text="Margins (fraction):")
        layout.prop(scene, "snap_uv_margin_x")
        layout.prop(scene, "snap_uv_margin_y")
        layout.separator()
        layout.label(text="Additional Options:")
        layout.prop(scene, "snap_uv_preserve")
        layout.prop(scene, "snap_uv_independent")
        layout.separator()
        layout.label(text="Painting:")
        layout.prop(scene, "snap_uv_easy_mode")
        if scene.snap_uv_easy_mode:
            layout.prop(scene, "snap_uv_easy_variant")
            layout.prop(scene, "snap_uv_easy_drag_gradient")
            layout.prop(scene, "snap_uv_easy_through")
        layout.prop(scene, "snap_uv_path_style")
        layout.prop(scene, "snap_uv_show_gradients")
        layout.prop(scene, "snap_uv_gradient_snap")
        layout.prop(scene, "snap_uv_path_stabilizer")
        layout.prop(scene, "snap_uv_gradient_direction")
        layout.separator()
        box = layout.box()
        box.prop(scene, "snap_uv_cavity_expanded", text="Cavity / Fake AO",
                 icon='TRIA_DOWN' if scene.snap_uv_cavity_expanded else 'TRIA_RIGHT',
                 emboss=False)
        if scene.snap_uv_cavity_expanded:
            box.prop(scene, "snap_uv_cavity_strength")
            box.prop(scene, "snap_uv_edge_strength")
            box.prop(scene, "snap_uv_edge_threshold")
            box.prop(scene, "snap_uv_edge_falloff")
            box.prop(scene, "snap_uv_cavity_smooth")
            box.prop(scene, "snap_uv_cavity_contrast")
            box.prop(scene, "snap_uv_cavity_bias")
            box.prop(scene, "snap_uv_cavity_invert")
            box.prop(scene, "snap_uv_cavity_auto_preview")
        if scene.snap_uv_painting_active:
            stage = active_gradient_painter.easy_selection if active_gradient_painter else None
            if scene.snap_uv_easy_mode and (scene.snap_uv_easy_variant == 'SELECT' or stage is not None):
                if stage is not None and stage.confirmed:
                    layout.label(text=f"Ready: {len(stage.groups)} pieces", icon='CHECKMARK')
                else:
                    layout.label(text=f"Select pieces: {len(stage.groups) if stage else 0}")
            controls = layout.box()
            controls.prop(scene, "snap_uv_controls_expanded", text="Controls",
                          icon='TRIA_DOWN' if scene.snap_uv_controls_expanded else 'TRIA_RIGHT', emboss=False)
            if scene.snap_uv_controls_expanded:
                if scene.snap_uv_easy_mode:
                    if scene.snap_uv_easy_variant == 'SELECT':
                        if stage is not None and stage.confirmed:
                            controls.label(text="Enter / Space / cell click: apply cell")
                            if scene.snap_uv_easy_drag_gradient:
                                controls.label(text="LMB: paint / drag: gradient on selection")
                                controls.label(text="Backspace: edit selection / Esc: clear")
                            else:
                                controls.label(text="LMB: next selection / Shift: subtract")
                            controls.label(text="L / Shift+L: linked select / deselect")
                        else:
                            controls.label(text="LMB drag: add / Shift: subtract")
                            controls.label(text="Enter / Space / cell click: paint")
                            controls.label(text="Tab + LMB: gradient on selection")
                    else:
                        controls.label(text="Shift + mesh click: collect pieces")
                        controls.label(text="Shift + Ctrl/Cmd + click: subtract")
                        controls.label(text="Enter / Space: confirm set for painting")
                        controls.label(text="Esc / RMB: clear set, return to Automatic")
                        controls.label(text="Mesh click: paint and select piece")
                        if scene.snap_uv_easy_drag_gradient:
                            controls.label(text="LMB drag: gradient / click applies on release")
                            if scene.snap_uv_path_style == 'BEZIER':
                                controls.label(text="Drag: two-point curve / Tab: multiple points")
                        controls.label(text="Cell click: recolor selected pieces")
                controls.label(text="Alt/Option + cell: Project from View")
                controls.label(text="Replaces gradient on selected pieces")
                controls.label(text="Works on the current cell too")
                controls.label(text="Shift + Ctrl/Cmd + cell: Select UVs")
                controls.label(text="LMB drag in UV: Box Select")
                controls.label(text="Shift/Ctrl + drag: Add/Subtract")
                if scene.snap_uv_path_style == 'CIRCLE':
                    controls.label(text="Tab + drag: circle center / radius")
                    controls.label(text="Drag axis handles: ellipse")
                elif scene.snap_uv_path_style == 'BEZIER':
                    controls.label(text="Hold Tab: click/drag curve points")
                    controls.label(text="Release Tab: finish curve")
                else:
                    controls.label(text="Tab + LMB: draw path")
                if scene.snap_uv_show_gradients:
                    controls.label(text="Cyan: move / Purple: rotate")
                    controls.label(text="White points: edit shape")
                controls.label(text="F8: toggle gradient snapping")
                controls.label(text="Ctrl/Cmd+Z: undo / Shift: redo")
                controls.label(text="Tab + Shift + LMB: distance source")
                controls.label(text="Shift + cell: radial")
                controls.label(text="Ctrl/Cmd + cell: cavity")
                if scene.snap_uv_easy_mode:
                    controls.label(text="RMB / Esc: clear selection, keep painting")
                    if scene.snap_uv_easy_variant == 'SELECT':
                        controls.label(text="Empty click: clear selection")
                    controls.label(text="Stop Painting button: exit")
                else:
                    controls.label(text="RMB or Esc: stop")
            layout.operator("uv.stop_painting", text="Stop Painting")
        else:
            edit_mesh = context.edit_object
            if edit_mesh is None or edit_mesh.type != 'MESH':
                layout.label(text="Enter Mesh Edit Mode to paint", icon='INFO')
            row = layout.row()
            row.enabled = edit_mesh is not None and edit_mesh.type == 'MESH'
            row.operator("uv.draw_path_gradient", text="Start Painting")


# --- Registration ---

classes = (
    UV_OT_draw_path_gradient,
    UV_OT_clear_path_gradient,
    UV_OT_stop_painting,
    UV_OT_snap_to_grid,
    UV_PT_snap_to_grid_panel,
)

def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    init_properties()
    bpy.app.timers.register(reset_painting_state, first_interval=0.0)
    ensure_path_gradient_overlay()
    ensure_uv_box_overlay()


def unregister():
    reset_painting_state()
    remove_path_gradient_overlay()
    remove_uv_box_overlay()
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    clear_properties()

if __name__ == "__main__":
    register()
