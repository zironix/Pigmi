bl_info = {
    "name": "Pigmi: UV to Palette",
    "author": "Oleg Pavlov",
    "version": (1, 6, 5),
    "blender": (5, 0, 0),
    "location": (
        "UV Editor > Sidebar > Snap UV or via hotkeys "
        "(Shift+X, Shift+Alt+X, Shift+Ctrl/Cmd+X)"
    ),
    "description": (
        "Moves and scales selected UVs to fit into a chosen texture grid cell."
    ),
    "category": "UV",
}

import bpy
import bmesh
import math
import sys
from mathutils import Vector

# --- Helper functions ---

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

    # The center resolves the ambiguous case where a coordinate lies exactly on
    # a grid border. Bounds are then checked inclusively with a tiny tolerance.
    center_uv = Vector(((min_u + max_u) * 0.5, (min_v + max_v) * 0.5))
    cell_x, cell_y_top = uv_to_cell_index_top(
        center_uv, grid_cell_width_uv, grid_cell_height_uv)

    cell_min_u = cell_x * grid_cell_width_uv
    cell_max_u = cell_min_u + grid_cell_width_uv
    cell_max_v = 1.0 - cell_y_top * grid_cell_height_uv
    cell_min_v = cell_max_v - grid_cell_height_uv
    tolerance = max(
        min(grid_cell_width_uv, grid_cell_height_uv) * 1e-6,
        1e-9,
    )

    inside = (
        min_u >= cell_min_u - tolerance
        and max_u <= cell_max_u + tolerance
        and min_v >= cell_min_v - tolerance
        and max_v <= cell_max_v + tolerance
    )
    if not inside:
        return False, None
    return True, (cell_x, cell_y_top)


def loop_uv_selected(loop, uv_layer, tool_settings=None):
    """Return True if this UV loop/corner participates in the selection."""
    if loop.face.hide:
        return False

    if tool_settings is not None and tool_settings.use_uv_select_sync:
        # In UV Sync mode, mesh selection is authoritative. A selected edge owns
        # both adjacent corners: the loop before it and the loop on the edge.
        sel_mode = tool_settings.mesh_select_mode
        if sel_mode[2]:
            return bool(loop.face.select)
        if sel_mode[1]:
            current_edge_selected = loop.edge.select and not loop.edge.hide
            previous_edge = loop.link_loop_prev.edge
            previous_edge_selected = previous_edge.select and not previous_edge.hide
            return bool(current_edge_selected or previous_edge_selected)
        return bool(loop.vert.select and not loop.vert.hide)

    uv_data = loop[uv_layer]
    if bool(getattr(uv_data, "select", False)):
        return True
    if bool(getattr(uv_data, "select_vert", False)):
        return True

    # UV edge selection is stored on the loop at the start of the edge, so the
    # previous loop's edge flag selects the current corner as its second end.
    if bool(getattr(uv_data, "select_edge", False)):
        return True
    previous_uv_data = loop.link_loop_prev[uv_layer]
    if bool(getattr(previous_uv_data, "select_edge", False)):
        return True

    # Compatibility fallback for APIs exposing selection directly on BMLoop.
    for attr in ("uv_select", "uv_select_vert", "uv_select_edge"):
        if bool(getattr(loop, attr, False)):
            return True
    return bool(getattr(loop.link_loop_prev, "uv_select_edge", False))


def uv_edges_connected(loop_a, loop_b, uv_layer, threshold):
    """Return whether two loops represent the same continuous UV edge."""
    endpoints_a = {
        loop_a.vert: loop_a[uv_layer].uv,
        loop_a.link_loop_next.vert: loop_a.link_loop_next[uv_layer].uv,
    }
    endpoints_b = {
        loop_b.vert: loop_b[uv_layer].uv,
        loop_b.link_loop_next.vert: loop_b.link_loop_next[uv_layer].uv,
    }
    if endpoints_a.keys() != endpoints_b.keys():
        return False

    threshold_squared = threshold * threshold
    return all(
        (endpoints_a[vert] - endpoints_b[vert]).length_squared
        <= threshold_squared
        for vert in endpoints_a
    )


def get_selected_uv_islands(bm, uv_layer, tool_settings, threshold=1e-6):
    """Return selected UV loops grouped by real UV-island connectivity."""
    visible_faces = [face for face in bm.faces if not face.hide]
    selected_by_face = {}
    edge_loops = {}

    for face in visible_faces:
        selected_loops = []
        for loop in face.loops:
            edge_loops.setdefault(loop.edge, []).append(loop)
            if loop_uv_selected(loop, uv_layer, tool_settings):
                selected_loops.append(loop)
        if selected_loops:
            selected_by_face[face] = selected_loops

    if not selected_by_face:
        return []

    adjacency = {face: set() for face in visible_faces}
    for loops in edge_loops.values():
        for index, loop_a in enumerate(loops):
            for loop_b in loops[index + 1:]:
                if loop_a.face is loop_b.face:
                    continue
                if uv_edges_connected(loop_a, loop_b, uv_layer, threshold):
                    adjacency[loop_a.face].add(loop_b.face)
                    adjacency[loop_b.face].add(loop_a.face)

    islands = []
    visited = set()
    for selected_face in selected_by_face:
        if selected_face in visited:
            continue

        stack = [selected_face]
        island_loops = []
        while stack:
            face = stack.pop()
            if face in visited:
                continue
            visited.add(face)
            island_loops.extend(selected_by_face.get(face, ()))
            stack.extend(adjacency[face] - visited)

        if island_loops:
            islands.append(island_loops)

    return islands


def fit_uv_group(
        loops_data,
        uv_layer,
        target_min_u,
        target_min_v,
        effective_cell_width_uv,
        effective_cell_height_uv,
        grid_cell_width_uv,
        grid_cell_height_uv,
        margin_x_uv,
        margin_y_uv,
        preserve):
    """Move one UV group into the target cell."""
    coords = [uv for _, uv in loops_data]
    snapped, old_cell = (
        is_already_snapped(
            coords, grid_cell_width_uv, grid_cell_height_uv)
        if preserve else (False, None)
    )

    if snapped:
        old_cell_x, old_cell_y_top = old_cell
        old_min_u = old_cell_x * grid_cell_width_uv + margin_x_uv
        old_min_v = (
            1.0 - (old_cell_y_top + 1) * grid_cell_height_uv
            + margin_y_uv
        )
        offset = Vector((target_min_u - old_min_u, target_min_v - old_min_v))
        for loop, uv_orig in loops_data:
            loop[uv_layer].uv = uv_orig + offset
        return

    min_u = min(uv.x for uv in coords)
    max_u = max(uv.x for uv in coords)
    min_v = min(uv.y for uv in coords)
    max_v = max(uv.y for uv in coords)
    bbox_width = max_u - min_u
    bbox_height = max_v - min_v
    center_u = target_min_u + effective_cell_width_uv * 0.5
    center_v = target_min_v + effective_cell_height_uv * 0.5
    epsilon = 1e-12

    for loop, uv_orig in loops_data:
        new_u = (
            center_u
            if bbox_width <= epsilon
            else target_min_u
            + (uv_orig.x - min_u) * effective_cell_width_uv / bbox_width
        )
        new_v = (
            center_v
            if bbox_height <= epsilon
            else target_min_v
            + (uv_orig.y - min_v) * effective_cell_height_uv / bbox_height
        )
        loop[uv_layer].uv = Vector((new_u, new_v))

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
        description=(
            "If enabled, if the selected UVs (or islands) are already snapped "
            "to a cell, their relative position and scale relative to that "
            "cell are preserved when moving to a new cell."
        ))
    sc.snap_uv_independent = bpy.props.BoolProperty(
        name="Independent Islands", default=False,
        description=(
            "If enabled, process each UV island independently. When the mesh "
            "is split (via Mesh → Split → Selection), the loose parts are "
            "treated as separate islands."
        ))


def clear_properties():
    sc = bpy.types.Scene
    property_names = (
        "snap_uv_texture_width",
        "snap_uv_texture_height",
        "snap_uv_cell_width",
        "snap_uv_cell_height",
        "snap_uv_margin_x",
        "snap_uv_margin_y",
        "snap_uv_preserve",
        "snap_uv_independent",
    )
    for property_name in property_names:
        if hasattr(sc, property_name):
            delattr(sc, property_name)


def is_uv_editor_area(area):
    if area is None or area.type != 'IMAGE_EDITOR':
        return False
    space = area.spaces.active
    return getattr(space, "ui_mode", "UV") == 'UV'


def get_window_region(area):
    return next(
        (region for region in area.regions if region.type == 'WINDOW'),
        None,
    )

# --- Operator ---

class UV_OT_snap_to_grid(bpy.types.Operator):
    """Move and scale selected UVs after a click in the UV Editor.

Call the operator from any window (e.g., from 3D View or UV Editor).
Then switch to the UV Editor and click on the desired texture cell."""
    bl_idname = "uv.snap_to_grid"
    bl_label = "Snap UV to Palette cell"
    bl_options = {'REGISTER', 'UNDO'}

    @classmethod
    def poll(cls, context):
        obj = context.edit_object
        return obj is not None and obj.type == 'MESH'

    def invoke(self, context, event):
        # Determine override values based on hotkey modifiers.
        # For Shift+Alt+X: override preserve = not (scene value)
        # For Shift+Ctrl+X: override independent = not (scene value)
        oskey = bool(getattr(event, "oskey", False))
        if event.shift and event.alt and not event.ctrl and not oskey:
            self.override_preserve = not context.scene.snap_uv_preserve
        else:
            self.override_preserve = None

        if event.shift and (event.ctrl or oskey) and not event.alt:
            self.override_independent = not context.scene.snap_uv_independent
        else:
            self.override_independent = None

        # Always use the WINDOW region. Panel buttons are invoked from the UI
        # sidebar region, whose View2D does not represent UV coordinates.
        if is_uv_editor_area(context.area):
            uv_area = context.area
        else:
            # If not called from UV Editor, search for one in the current screen.
            uv_area = next(
                (
                    area for area in context.window.screen.areas
                    if is_uv_editor_area(area)
                ),
                None,
            )
            if uv_area is None:
                self.report({'ERROR'}, "UV Editor not found in the current screen")
                return {'CANCELLED'}

        uv_region = get_window_region(uv_area)
        if uv_region is None:
            self.report({'ERROR'}, "UV Editor window region not found")
            return {'CANCELLED'}

        self.uv_area = uv_area
        self.uv_region = uv_region

        context.window_manager.modal_handler_add(self)
        self.report({'INFO'}, "Left-click in the UV Editor to choose the target cell")
        return {'RUNNING_MODAL'}

    def modal(self, context, event):
        if event.type == 'LEFTMOUSE' and event.value == 'PRESS':
            # Determine local coordinates of the click in the UV Editor.
            local_x = event.mouse_x - self.uv_region.x
            local_y = event.mouse_y - self.uv_region.y
            if not (0 <= local_x <= self.uv_region.width and 0 <= local_y <= self.uv_region.height):
                self.report({'WARNING'}, "Click outside UV Editor area")
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

            # Compute cell size in UV coordinates; [0,1] is the full texture.
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

            # Get the active mesh in Edit Mode.
            obj = context.edit_object
            if obj is None or obj.type != 'MESH':
                self.report({'ERROR'}, "The active object is not a mesh or not in Edit Mode")
                return {'CANCELLED'}

            bm = bmesh.from_edit_mesh(obj.data)
            uv_layer = bm.loops.layers.uv.active
            if uv_layer is None:
                self.report({'ERROR'}, "Active UV layer not found")
                return {'CANCELLED'}

            # Determine effective option values (override if hotkey modifiers were used)
            preserve_value = (
                self.override_preserve
                if self.override_preserve is not None
                else scene.snap_uv_preserve
            )
            independent_value = (
                self.override_independent
                if self.override_independent is not None
                else scene.snap_uv_independent
            )

            # --- Processing ---
            if independent_value:
                loop_groups = get_selected_uv_islands(
                    bm, uv_layer, context.tool_settings)
            else:
                selected_loops = [
                    loop
                    for face in bm.faces if not face.hide
                    for loop in face.loops
                    if loop_uv_selected(loop, uv_layer, context.tool_settings)
                ]
                loop_groups = [selected_loops] if selected_loops else []

            if not loop_groups:
                self.report({'ERROR'}, "No UVs selected")
                return {'CANCELLED'}

            for loop_group in loop_groups:
                loops_data = [
                    (loop, loop[uv_layer].uv.copy())
                    for loop in loop_group
                ]
                fit_uv_group(
                    loops_data,
                    uv_layer,
                    target_min_u,
                    target_min_v,
                    effective_cell_width_uv,
                    effective_cell_height_uv,
                    grid_cell_width_uv,
                    grid_cell_height_uv,
                    margin_x_uv,
                    margin_y_uv,
                    preserve_value,
                )

            bmesh.update_edit_mesh(
                obj.data, loop_triangles=False, destructive=False)
            self.report(
                {'INFO'},
                f"UVs moved to cell "
                f"(x={target_cell_x}, y_from_top={target_cell_y_top})",
            )
            return {'FINISHED'}

        elif event.type in {'RIGHTMOUSE', 'ESC'}:
            self.report({'INFO'}, "Operation cancelled")
            return {'CANCELLED'}

        return {'RUNNING_MODAL'}

# --- UI Panel ---

class UV_PT_snap_to_grid_panel(bpy.types.Panel):
    """Snap UV Panel in the UV Editor"""
    bl_space_type = 'IMAGE_EDITOR'
    bl_region_type = 'UI'
    bl_category = "Snap UV"
    bl_label = "Pigmi: UV to Palette"

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        if not UV_OT_snap_to_grid.poll(context):
            layout.label(text="Select a mesh and enter Edit Mode", icon='INFO')
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
        layout.operator("uv.snap_to_grid", text="Snap UV (Click)")

# --- Registration and Hotkeys ---

addon_keymaps = []

classes = (
    UV_OT_snap_to_grid,
    UV_PT_snap_to_grid_panel,
)


def register_hotkeys(keymap):
    bindings = [
        {"shift": True, "alt": False, "ctrl": False},
        {"shift": True, "alt": True, "ctrl": False},
        {"shift": True, "alt": False, "ctrl": True},
    ]
    # Keep physical Control working on macOS and add the familiar Command alias.
    if sys.platform == "darwin":
        bindings.append(
            {"shift": True, "alt": False, "ctrl": False, "oskey": True})

    for modifiers in bindings:
        keymap_item = keymap.keymap_items.new(
            "uv.snap_to_grid",
            type="X",
            value="PRESS",
            **modifiers,
        )
        addon_keymaps.append((keymap, keymap_item))


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    init_properties()

    wm = bpy.context.window_manager
    addon_keyconfig = wm.keyconfigs.addon
    if addon_keyconfig is None:
        return

    # Mesh Edit Mode and the UV-specific editor map intentionally share bindings.
    km_mesh = addon_keyconfig.keymaps.new(name="Mesh", space_type="EMPTY")
    register_hotkeys(km_mesh)
    km_uv = addon_keyconfig.keymaps.new(name="UV Editor", space_type="EMPTY")
    register_hotkeys(km_uv)


def unregister():
    for km, kmi in addon_keymaps:
        km.keymap_items.remove(kmi)
    addon_keymaps.clear()
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    clear_properties()

if __name__ == "__main__":
    register()
