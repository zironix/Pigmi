bl_info = {
    "name": "Pigmi: UV to Palette",
    "author": "Oleg Pavlov",
    "version": (1, 9, 11),
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
from array import array
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from bpy_extras import view3d_utils

# --- Helper functions ---

path_gradient_draw_handle = None
uv_box_draw_handle = None
uv_box_preview_area = None
uv_box_preview_points = None


def draw_uv_box_selection_overlay():
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


def draw_path_gradient_overlay():
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
    else:
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


def build_screen_polyline_batch(batch_for_shader, points, width, gradient=False):
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
            start_color = preview_gradient_color(index / segment_count)
            end_color = preview_gradient_color((index + 1) / segment_count)
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
    global path_gradient_draw_handle
    if path_gradient_draw_handle is None:
        path_gradient_draw_handle = bpy.types.SpaceView3D.draw_handler_add(
            draw_path_gradient_overlay, (), 'WINDOW', 'POST_PIXEL')


def remove_path_gradient_overlay():
    global path_gradient_draw_handle
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


def apply_path_gradient_screen_uvs(loops_data, obj, uv_layer, screen_points, region, rv3d,
                                   target_min_u, target_min_v, effective_cell_width_uv,
                                   effective_cell_height_uv, direction):
    if not loops_data or len(screen_points) < 2:
        return

    center_v = target_min_v + effective_cell_height_uv * 0.5
    center_u = target_min_u + effective_cell_width_uv * 0.5
    world_matrix = obj.matrix_world

    for loop, _uv_orig in loops_data:
        world_point = world_matrix @ loop.vert.co
        screen_point = view3d_utils.location_3d_to_region_2d(region, rv3d, world_point)
        if screen_point is None:
            continue
        progress, _distance = closest_path_progress(screen_point, screen_points)
        if direction == 'RIGHT_TO_LEFT':
            loop[uv_layer].uv = Vector((target_min_u + (1.0 - progress) * effective_cell_width_uv, center_v))
        elif direction == 'BOTTOM_TO_TOP':
            loop[uv_layer].uv = Vector((center_u, target_min_v + progress * effective_cell_height_uv))
        elif direction == 'TOP_TO_BOTTOM':
            loop[uv_layer].uv = Vector((center_u, target_min_v + (1.0 - progress) * effective_cell_height_uv))
        else:
            loop[uv_layer].uv = Vector((target_min_u + progress * effective_cell_width_uv, center_v))


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
    sc.snap_uv_path_style = bpy.props.EnumProperty(
        name="Path Style",
        default='FREEHAND',
        items=[
            ('FREEHAND', "Freehand", "Draw a freehand path in the 3D View"),
            ('STRAIGHT', "Straight", "Draw a straight gradient line from press to release"),
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
        "snap_uv_path_style", "snap_uv_gradient_direction",
        "snap_uv_path_stabilizer", "snap_uv_cavity_strength",
        "snap_uv_edge_strength", "snap_uv_edge_threshold",
        "snap_uv_edge_falloff", "snap_uv_cavity_smooth",
        "snap_uv_cavity_contrast", "snap_uv_cavity_bias",
        "snap_uv_cavity_invert", "snap_uv_cavity_auto_preview",
        "snap_uv_last_cell_x", "snap_uv_last_cell_y_top",
        "snap_uv_painting_active",
    )
    for property_name in property_names:
        if hasattr(sc, property_name):
            delattr(sc, property_name)


def reset_painting_state():
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
        self.stop_timer = context.window_manager.event_timer_add(0.2, window=context.window)
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
        return Vector((event.mouse_x - self.region.x, event.mouse_y - self.region.y))

    def append_point(self, point, screen_point):
        if screen_point is None:
            return
        stabilizer = getattr(self.scene, "snap_uv_path_stabilizer", 0.55)
        screen_point = stabilized_screen_point(self.last_screen_point, screen_point, stabilizer)
        min_distance = 2.0 + stabilizer * 5.0
        if self.last_screen_point is not None and (screen_point - self.last_screen_point).length < min_distance:
            return
        if point is not None and self.points and (point - self.points[-1]).length < self.min_point_distance:
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
        loops_data = selected_face_loop_data(bm, uv_layer, context.tool_settings)
        if not loops_data:
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
            return self.apply_selected_to_current_cell(
                context, project_from_view=True)
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
        current_signature = loops_selection_signature(all_selected_loops)
        current_settings_signature = self.fit_settings_signature(context)
        if (not project_from_view and
                self.last_applied_cell_min is not None and
                self.last_applied_cell_size is not None and
                self.last_applied_selection_signature == current_signature and
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
                self.last_applied_cell_min = Vector((self.target_min_u, self.target_min_v))
                self.last_applied_cell_size = Vector((self.effective_cell_width_uv, self.effective_cell_height_uv))
                self.last_applied_selection_signature = current_signature
                self.last_applied_settings_signature = current_settings_signature
                self.last_action_mode = 'FIT'
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
        self.last_applied_cell_min = Vector((self.target_min_u, self.target_min_v))
        self.last_applied_cell_size = Vector((self.effective_cell_width_uv, self.effective_cell_height_uv))
        self.last_applied_selection_signature = current_signature
        self.last_applied_settings_signature = current_settings_signature
        self.last_action_mode = 'PROJECT_FROM_VIEW' if project_from_view else 'FIT'
        if project_from_view:
            self.report({'INFO'}, "Projected from view and moved to palette cell")
        return True

    def clear_current_path(self, context):
        context.scene.snap_uv_path_points = ""
        context.scene.snap_uv_path_screen_points = ""
        redraw_view3d_areas(context)

    def modal(self, context, event):
        self.events_seen += 1
        if not context.scene.snap_uv_painting_active:
            self.finish_painting(context)
            self.report({'INFO'}, "Painting stopped")
            return {'CANCELLED'}

        if event.type in {'RIGHTMOUSE', 'ESC'}:
            self.finish_painting(context, restore_previous=self.state == 'PICK_CELL')
            self.report({'INFO'}, "Painting finished")
            return {'CANCELLED'}

        if event.type in {'RET', 'NUMPAD_ENTER'} and event.value == 'PRESS':
            self.finish_painting(context)
            self.report({'INFO'}, "Painting finished")
            return {'FINISHED'}

        if event.type == 'TIMER':
            if getattr(event, "timer", None) == self.stop_timer:
                self.maybe_auto_preview_cavity(context)
                return {'RUNNING_MODAL'}
            return {'PASS_THROUGH'}

        if event.type in {'LEFT_ALT', 'RIGHT_ALT'}:
            self.alt_modifier_held = event.value != 'RELEASE'
            return {'RUNNING_MODAL'}

        if event.type == 'WINDOW_DEACTIVATE':
            self.draw_modifier_held = False
            self.alt_modifier_held = False
            self.swallow_uv_mouse_type = None
            self.uv_mouse_press = None
            self.uv_mouse_dragging = False
            clear_uv_box_preview()
            self.drawing = False
            self.edit_bvh = None
            return {'RUNNING_MODAL'}

        alt_active = alt_modifier_active(event, self.alt_modifier_held)
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
                event.type == self.uv_mouse_press["mouse_type"] and
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
            return {'RUNNING_MODAL'}

        if event.type == 'LEFTMOUSE' and event.value == 'RELEASE' and self.drawing:
            self.drawing = False
            if len(self.screen_points) == 1:
                self.append_point(self.raycast_mesh(context, event), self.mouse_screen_point(context, event))
            if len(self.screen_points) < 2:
                context.scene.snap_uv_path_debug = (
                    f"events={self.events_seen}, attempts={self.raycast_attempts}, "
                    f"hits={self.raycast_hits}, screen_points={len(self.screen_points)}")
                self.finish_drawing()
                self.report({'ERROR'}, "Path needs at least two screen points. " + context.scene.snap_uv_path_debug)
                return {'CANCELLED'}
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
                self.report({'INFO'}, f"Path gradient mapped to cell (x={target_cell_x}, y_from_top={target_cell_y_top})")
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
        layout.prop(scene, "snap_uv_path_style")
        layout.prop(scene, "snap_uv_path_stabilizer")
        layout.prop(scene, "snap_uv_gradient_direction")
        layout.separator()
        layout.label(text="Cavity / Fake AO:")
        layout.prop(scene, "snap_uv_cavity_strength")
        layout.prop(scene, "snap_uv_edge_strength")
        layout.prop(scene, "snap_uv_edge_threshold")
        layout.prop(scene, "snap_uv_edge_falloff")
        layout.prop(scene, "snap_uv_cavity_smooth")
        layout.prop(scene, "snap_uv_cavity_contrast")
        layout.prop(scene, "snap_uv_cavity_bias")
        layout.prop(scene, "snap_uv_cavity_invert")
        layout.prop(scene, "snap_uv_cavity_auto_preview")
        if scene.snap_uv_painting_active:
            layout.label(text="Alt/Option + cell: Project from View")
            layout.label(text="Shift + Ctrl/Cmd + cell: Select UVs")
            layout.label(text="LMB drag in UV: Box Select")
            layout.label(text="Shift/Ctrl + drag: Add/Subtract")
            layout.label(text="Tab + LMB: draw path")
            layout.label(text="Tab + Shift + LMB: distance source")
            layout.label(text="Shift + cell: radial")
            layout.label(text="Ctrl/Cmd + cell: cavity")
            layout.label(text="RMB or Esc: stop")
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
