bl_info = {
    "name": "Pigmi: Highlighter",
    "author": "Pavlov Oleg (final)",
    "version": (1, 13, 0),
    "blender": (5, 0, 0),
    "location": "View3D > Tool",
    "description": "Pigmi Highlighter — vertex-color highlighter with palette and quick fills",
    "category": "Paint",
}

import bpy
import bmesh
from array import array
from collections import deque
from bpy.props import (
    FloatVectorProperty, BoolProperty, IntProperty,
    PointerProperty, FloatProperty, CollectionProperty
)
from bpy.types import Panel, Operator, PropertyGroup

MAIN_ATTRIBUTE = "Col"
COLOR_DOMAINS = {'CORNER', 'POINT'}

# Preview backups live in memory only: key -> {'name', 'domain', 'data': array('f')}.
_PREVIEW_BACKUP = {}
# Set while an operator changes the color sliders itself, so the slider update
# callback does not paint a second time with the radius settings.
_SUPPRESS_PARAM_UPDATE = False

# ------------------------------
# Helpers
# ------------------------------
def debug_print(*args):
    try:
        print("[Pigmi]", *args)
    except Exception:
        pass

def _make_key(obj, me):
    return f"{int(obj.as_pointer())}_{int(me.as_pointer())}"

def _redraw_3d_views():
    try:
        for area in bpy.context.screen.areas:
            if area.type == 'VIEW_3D':
                area.tag_redraw()
    except Exception:
        pass

def get_existing_color_attribute(mesh, name=None):
    attrs = mesh.color_attributes
    if name:
        ca = attrs.get(name)
        if ca and ca.domain in COLOR_DOMAINS:
            return ca
    try:
        active = attrs.active_color
    except Exception:
        active = None
    if active is not None:
        ca = attrs.get(getattr(active, "name", ""))
        if ca and ca.domain in COLOR_DOMAINS:
            return ca
    for ca in attrs:
        if ca.domain in COLOR_DOMAINS:
            return ca
    return None

def activate_color_attribute(mesh, ca):
    """Shows the attribute in the viewport and uses it for rendering, without an undo step."""
    attrs = mesh.color_attributes
    for prop in ("active_color_name", "default_color_name"):
        try:
            setattr(attrs, prop, ca.name)
        except Exception:
            pass

def create_color_attribute(mesh, name=MAIN_ATTRIBUTE, domain='CORNER'):
    ca = mesh.color_attributes.get(name)
    if ca is None:
        try:
            ca = mesh.color_attributes.new(name=name, type='BYTE_COLOR', domain=domain)
        except Exception:
            ca = None
    if ca is not None:
        activate_color_attribute(mesh, ca)
    return ca

def get_or_create_color_attribute(mesh, name=MAIN_ATTRIBUTE, domain='CORNER'):
    ca = get_existing_color_attribute(mesh, name)
    if ca is None:
        return create_color_attribute(mesh, name=name, domain=domain)
    activate_color_attribute(mesh, ca)
    return ca

# ------------------------------
# Color I/O
#
# BMesh exposes byte colors as stored (sRGB) and float colors as linear values.
# Backups, restores and painting all use that same representation; in Object
# Mode the bulk foreach path reads color_srgb for byte attributes to match it.
#
# Attribute RNA references become invalid in Edit Mode once BMesh layers change,
# so the code keeps a plain (name, domain, data_type) spec instead.
# ------------------------------
def _attribute_spec(ca):
    return (ca.name, ca.domain, ca.data_type)

def _bmesh_layer(bm, spec):
    name, domain, data_type = spec
    elements = bm.loops if domain == 'CORNER' else bm.verts
    layers = elements.layers.float_color if data_type == 'FLOAT_COLOR' else elements.layers.color
    layer = layers.get(name)
    if layer is None:
        raise RuntimeError(f"Color layer {name!r} is missing from the mesh")
    return layer

def _bmesh_elements(bm, spec):
    if spec[1] == 'CORNER':
        return [loop for face in bm.faces for loop in face.loops]
    return list(bm.verts)

def _foreach_property(spec):
    return 'color_srgb' if spec[2] == 'BYTE_COLOR' else 'color'

def _open_bmesh(obj, me):
    if obj.mode == 'EDIT':
        return bmesh.from_edit_mesh(me), False
    bm = bmesh.new()
    bm.from_mesh(me)
    return bm, True

def _close_bmesh(obj, me, bm, owned, write):
    if owned:
        if write:
            bm.to_mesh(me)
        bm.free()
    elif write:
        bmesh.update_edit_mesh(me, loop_triangles=False, destructive=False)
    if write:
        me.update()

def _read_colors(obj, me, spec):
    if obj.mode != 'EDIT':
        ca = me.color_attributes[spec[0]]
        data = array('f', bytes(16 * len(ca.data)))
        ca.data.foreach_get(_foreach_property(spec), data)
        return data
    # Mesh attribute data is empty while the object is in Edit Mode.
    bm = bmesh.from_edit_mesh(me)
    layer = _bmesh_layer(bm, spec)
    return array('f', [channel for element in _bmesh_elements(bm, spec) for channel in element[layer]])

def _write_bmesh_colors(bm, spec, data):
    layer = _bmesh_layer(bm, spec)
    for index, element in enumerate(_bmesh_elements(bm, spec)):
        offset = index * 4
        element[layer] = data[offset:offset + 4]

def _element_count(obj, me, spec):
    if obj.mode != 'EDIT':
        return len(me.color_attributes[spec[0]].data)
    bm = bmesh.from_edit_mesh(me)
    if spec[1] == 'CORNER':
        return sum(len(face.loops) for face in bm.faces)
    return len(bm.verts)

# ------------------------------
# Preview backup / restore
# ------------------------------
def _store_backup(obj, me, ca):
    spec = _attribute_spec(ca)
    _PREVIEW_BACKUP[_make_key(obj, me)] = {'spec': spec, 'data': _read_colors(obj, me, spec)}

def _backup_col_in_memory(obj, me):
    if _make_key(obj, me) in _PREVIEW_BACKUP:
        return
    ca = get_or_create_color_attribute(me)
    if ca is not None:
        _store_backup(obj, me, ca)

def _overwrite_backup_with_current(obj, me):
    ca = get_or_create_color_attribute(me)
    if ca is None:
        raise RuntimeError("No color attribute to back up")
    _store_backup(obj, me, ca)

def _backup_for(obj, me):
    """Returns the backup while it still fits the mesh, otherwise None."""
    backup = _PREVIEW_BACKUP.get(_make_key(obj, me))
    if not backup:
        return None
    spec = backup['spec']
    ca = me.color_attributes.get(spec[0])
    # Blender reuses object memory, so a key can outlive its object (e.g. after undo).
    if ca is None or _attribute_spec(ca) != spec:
        return None
    # A topology edit since the backup would scramble colors; refuse instead.
    if _element_count(obj, me, spec) * 4 != len(backup['data']):
        debug_print("Preview backup no longer matches the mesh topology")
        return None
    return backup

def _restore_col_from_memory(obj, me):
    backup = _backup_for(obj, me)
    if backup is None:
        return False
    spec = backup['spec']
    if obj.mode != 'EDIT':
        me.color_attributes[spec[0]].data.foreach_set(_foreach_property(spec), backup['data'])
        me.update()
    else:
        bm = bmesh.from_edit_mesh(me)
        _write_bmesh_colors(bm, spec, backup['data'])
        _close_bmesh(obj, me, bm, False, True)
    _redraw_3d_views()
    return True

def _clear_backup(obj, me):
    _PREVIEW_BACKUP.pop(_make_key(obj, me), None)

# ------------------------------
# Preview helpers: enable/disable
# ------------------------------
def _preview_enable(obj, me):
    # A stale backup (from an object that previously lived at this address) is replaced.
    if _backup_for(obj, me) is None:
        _clear_backup(obj, me)
    try:
        _backup_col_in_memory(obj, me)
    except Exception as e:
        debug_print("_preview_enable: backup failed:", e)
    _redraw_3d_views()

def _preview_disable(obj, me, clear_backup=True):
    try:
        _restore_col_from_memory(obj, me)
    except Exception as e:
        debug_print("_preview_disable: restore failed:", e)
    if clear_backup:
        _clear_backup(obj, me)
    _redraw_3d_views()

# ------------------------------
# Selection / weights
# ------------------------------
def detect_selection_mode(context):
    ts = context.tool_settings
    if not ts:
        return 'FACE'
    msm = ts.mesh_select_mode
    if len(msm) >= 3:
        if msm[2]:
            return 'FACE'
        if msm[1]:
            return 'EDGE'
        if msm[0]:
            return 'VERT'
    return 'FACE'

def compute_vertex_weights_with_radius(bm, selected_vertices_idx, radius, iterations, falloff_power=1.0):
    """Returns {vertex index: weight} for every vertex with a non-zero weight.

    Weights are non-zero only within `radius` edges of the selection, and each
    smoothing iteration spreads them one more edge, so only that region is
    visited. Sums run in link_edges order to match a full-mesh computation.
    """
    bm.verts.ensure_lookup_table()
    verts = bm.verts
    n = len(verts)
    iterations = max(0, iterations)
    max_depth = (int(radius) if radius > 0 else 0) + iterations

    neighbors = {}
    def neighbors_of(i):
        result = neighbors.get(i)
        if result is None:
            v = verts[i]
            result = neighbors[i] = [e.other_vert(v).index for e in v.link_edges]
        return result

    dist = {}
    dq = deque()
    for vi in selected_vertices_idx:
        if 0 <= vi < n and vi not in dist:
            dist[vi] = 0
            dq.append(vi)
    while dq:
        v_idx = dq.popleft()
        next_dist = dist[v_idx] + 1
        if next_dist > max_depth:
            continue
        for oi in neighbors_of(v_idx):
            if oi not in dist:
                dist[oi] = next_dist
                dq.append(oi)

    if radius <= 0:
        weights = {i: (1.0 if d == 0 else 0.0) for i, d in dist.items()}
    else:
        scale = max(1e-6, radius)
        weights = {
            i: (max(0.0, (1.0 - d / scale) ** falloff_power) if d <= radius else 0.0)
            for i, d in dist.items()
        }
    region = list(dist)
    for _ in range(iterations):
        smoothed = {}
        for i in region:
            total = weights[i]
            nb = neighbors_of(i)
            for o in nb:
                total += weights.get(o, 0.0)
            smoothed[i] = total / (len(nb) + 1)
        weights = smoothed
    return {i: min(1.0, max(0.0, w)) for i, w in weights.items() if w > 0.0}

# ------------------------------
# Core: apply
# ------------------------------
def _blend(current, rgba, w):
    return (
        current[0] * (1.0 - w) + rgba[0] * w,
        current[1] * (1.0 - w) + rgba[1] * w,
        current[2] * (1.0 - w) + rgba[2] * w,
        current[3] * (1.0 - w) + rgba[3] * w,
    )

def _selected_vertex_indices(bm, sel_mode):
    if sel_mode == 'EDGE':
        selected = set()
        for e in bm.edges:
            if e.select:
                selected.add(e.verts[0].index)
                selected.add(e.verts[1].index)
        return list(selected)
    return [v.index for v in bm.verts if v.select]

def set_colors_on_mesh(context, rgba, radius, iterations, falloff_power, preview_mode=False):
    obj = context.object
    if not obj or obj.type != 'MESH':
        return

    me = obj.data
    ca = get_or_create_color_attribute(me, name=MAIN_ATTRIBUTE)
    if not ca:
        return
    spec = _attribute_spec(ca)
    rgba = tuple(float(c) for c in rgba[:4])

    # Preview paints over the backup, so restoring and painting share one BMesh pass.
    backup = _backup_for(obj, me) if preview_mode else None

    bm, owned = _open_bmesh(obj, me)
    try:
        bm.verts.ensure_lookup_table()
        if backup is not None:
            _write_bmesh_colors(bm, backup['spec'], backup['data'])
        layer = _bmesh_layer(bm, spec)
        corner = spec[1] == 'CORNER'
        sel_mode = detect_selection_mode(context)

        if sel_mode == 'FACE':
            selected_faces = [f for f in bm.faces if f.select]
            for face in selected_faces:
                for element in (face.loops if corner else face.verts):
                    element[layer] = rgba
        else:
            selected = _selected_vertex_indices(bm, sel_mode)
            if selected:
                weights = compute_vertex_weights_with_radius(bm, selected, radius, iterations, falloff_power)
                verts = bm.verts
                for v_idx, w in weights.items():
                    vert = verts[v_idx]
                    if corner:
                        for loop in vert.link_loops:
                            loop[layer] = _blend(loop[layer], rgba, w)
                    else:
                        vert[layer] = _blend(vert[layer], rgba, w)
    except Exception:
        _close_bmesh(obj, me, bm, owned, False)
        raise
    _close_bmesh(obj, me, bm, owned, True)

    activate_color_attribute(me, me.color_attributes[spec[0]])
    _redraw_3d_views()

# ------------------------------
# UI / props / operator
# ------------------------------
class PigmiProps(PropertyGroup):
    color: FloatVectorProperty(
        name="Color", size=4, subtype='COLOR',
        min=0.0, max=1.0,
        default=(1.0, 0.0, 0.0, 1.0),
        step=0.01, precision=3,
        update=lambda self, context: pigmi_param_update(self, context),
    )
    auto_apply: BoolProperty(name="Auto Apply", default=False)
    preview_mode: BoolProperty(name="Preview Mode", default=False, update=lambda self, context: pigmi_preview_toggle(self, context))
    radius: FloatProperty(name="Radius", default=0.0, min=0.0, max=100.0, update=lambda self, context: pigmi_param_update(self, context))
    iterations: IntProperty(name="Iterations", default=0, min=0, max=50, update=lambda self, context: pigmi_param_update(self, context))
    falloff_power: FloatProperty(name="Falloff Power", default=0.1, min=0.1, max=10.0, update=lambda self, context: pigmi_param_update(self, context))

# ------------------------------
# Palette: user-editable collection
# ------------------------------
class PigmiPaletteItem(PropertyGroup):
    color: FloatVectorProperty(name="Color", size=4, subtype='COLOR', min=0.0, max=1.0, default=(1.0,1.0,1.0,1.0))

class PIGMI_OT_add_palette(Operator):
    bl_idname = "pigmi.add_palette"
    bl_label = "Add Palette Color"
    def execute(self, context):
        sc = context.scene
        props = sc.pigmi_props
        item = sc.pigmi_palette.add()
        item.color = tuple(props.color)
        sc.pigmi_palette_index = max(0, len(sc.pigmi_palette) - 1)
        self.report({'INFO'}, "Pigmi: Palette color added")
        return {'FINISHED'}

class PIGMI_OT_remove_palette_item(Operator):
    bl_idname = "pigmi.remove_palette_item"
    bl_label = "Remove Palette Item"
    idx: IntProperty()
    def execute(self, context):
        sc = context.scene
        if 0 <= self.idx < len(sc.pigmi_palette):
            sc.pigmi_palette.remove(self.idx)
            # keep index sane
            sc.pigmi_palette_index = min(max(0, self.idx-1), max(0, len(sc.pigmi_palette)-1))
            self.report({'INFO'}, "Pigmi: Palette color removed")
            return {'FINISHED'}
        self.report({'WARNING'}, "Pigmi: Palette index out of range")
        return {'CANCELLED'}

class PIGMI_OT_use_palette_color(Operator):
    bl_idname = "pigmi.use_palette_color"
    bl_label = "Use Palette Color"
    idx: IntProperty()
    def execute(self, context):
        sc = context.scene
        props = sc.pigmi_props
        if 0 <= self.idx < len(sc.pigmi_palette):
            rgba = tuple(sc.pigmi_palette[self.idx].color)
            _set_color_silently(props, rgba)
            # apply to selection immediately (respect preview_mode)
            try:
                set_colors_on_mesh(context, rgba, radius=0.0, iterations=0, falloff_power=1.0, preview_mode=props.preview_mode)
            except Exception as e:
                debug_print("use_palette_color: apply failed:", e)
            self.report({'INFO'}, "Pigmi: Palette color applied")
            return {'FINISHED'}
        self.report({'WARNING'}, "Pigmi: Palette index out of range")
        return {'CANCELLED'}

# Operator: apply current color (same as slider updates)
class PIGMI_OT_apply_color(Operator):
    bl_idname = "pigmi.apply_color"
    bl_label = "Apply Pigmi Color"
    @classmethod
    def poll(cls, context):
        obj = context.object
        return obj is not None and obj.type == 'MESH'
    def execute(self, context):
        props = context.scene.pigmi_props
        rgba = tuple(props.color)
        set_colors_on_mesh(context, rgba, props.radius, props.iterations, props.falloff_power, props.preview_mode)
        self.report({'INFO'}, "Pigmi: Color applied")
        return {'FINISHED'}

# Operator: Save (commit preview)
class PIGMI_OT_commit_preview(Operator):
    bl_idname = "pigmi.commit_preview"
    bl_label = "Save"
    @classmethod
    def poll(cls, context):
        obj = context.object
        return obj is not None and obj.type == 'MESH'
    def execute(self, context):
        obj = context.object
        if obj is None or obj.type != 'MESH':
            self.report({'WARNING'}, "Pigmi: No mesh to commit.")
            return {'CANCELLED'}
        me = obj.data
        props = context.scene.pigmi_props

        try:
            _overwrite_backup_with_current(obj, me)
        except Exception as e:
            debug_print("commit_preview: backup failed:", e)
            self.report({'WARNING'}, "Pigmi: Failed to overwrite preview backup (see console).")
            return {'CANCELLED'}

        try:
            props.preview_mode = True
        except Exception:
            pass
        _redraw_3d_views()

        self.report({'INFO'}, "Pigmi: Preview committed — backup synced with mesh.")
        return {'FINISHED'}

# Operator: Restore (cancel preview)
class PIGMI_OT_cancel_preview(Operator):
    bl_idname = "pigmi.cancel_preview"
    bl_label = "Restore"
    @classmethod
    def poll(cls, context):
        obj = context.object
        return obj is not None and obj.type == 'MESH'
    def execute(self, context):
        obj = context.object
        me = obj.data
        restored = _restore_col_from_memory(obj, me)
        if restored:
            self.report({'INFO'}, "Pigmi: Preview restored from backup.")
        else:
            self.report({'WARNING'}, "Pigmi: No backup to restore.")
        return {'FINISHED'}

# Operator: fill entire mesh with specific color immediately (does not overwrite backup)
class PIGMI_OT_fill_all(Operator):
    bl_idname = "pigmi.fill_all"
    bl_label = "Fill All"
    color: FloatVectorProperty(name="Color", size=4, subtype='COLOR', min=0.0, max=1.0, default=(1,1,1,1))
    @classmethod
    def poll(cls, context):
        obj = context.object
        return obj is not None and obj.type == 'MESH'
    def execute(self, context):
        props = context.scene.pigmi_props
        rgba = tuple(self.color)
        _set_color_silently(props, rgba)
        obj = context.object
        if not obj or obj.type != 'MESH':
            self.report({'WARNING'}, "Pigmi: No mesh to fill.")
            return {'CANCELLED'}
        # Use existing pipeline so selection mode, preview, and blending behave the same
        try:
            set_colors_on_mesh(context, rgba, radius=0.0, iterations=0, falloff_power=1.0, preview_mode=props.preview_mode)
        except Exception as e:
            debug_print("fill_all: set_colors_on_mesh failed:", e)
            self.report({'WARNING'}, "Pigmi: Fill failed (see console)")
            return {'CANCELLED'}
        self.report({'INFO'}, "Pigmi: Filled selection")
        return {'FINISHED'}

def _set_color_silently(props, rgba):
    global _SUPPRESS_PARAM_UPDATE
    _SUPPRESS_PARAM_UPDATE = True
    try:
        props.color = rgba
    except Exception:
        pass
    finally:
        _SUPPRESS_PARAM_UPDATE = False

def pigmi_param_update(self, context):
    if _SUPPRESS_PARAM_UPDATE:
        return
    props = context.scene.pigmi_props
    if not props.auto_apply or not context.object or context.object.type != 'MESH':
        return
    set_colors_on_mesh(context, tuple(props.color), props.radius, props.iterations, props.falloff_power, preview_mode=props.preview_mode)

def pigmi_preview_toggle(self, context):
    props = context.scene.pigmi_props
    obj = context.object
    if not obj or obj.type != 'MESH':
        return
    me = obj.data
    if props.preview_mode:
        _preview_enable(obj, me)
    else:
        _preview_disable(obj, me, clear_backup=True)

# ------------------------------
# UI Panel
# ------------------------------
class PIGMI_PT_panel(Panel):
    bl_label = "Pigmi: Highlighter"
    bl_idname = "VIEW3D_PT_pigmi_highlighter"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Tool"
    @classmethod
    def poll(cls, context):
        return context.object is not None and context.object.type == 'MESH'
    def draw(self, context):
        layout = self.layout
        props = context.scene.pigmi_props
        col = layout.column(align=True)
        col.label(text="Color preview:")
        col.prop(props, "color", text="")
        col.separator()
        row = col.row(align=True)
        row.prop(props, "color", index=0, slider=True, text="R")
        row.prop(props, "color", index=1, slider=True, text="G")
        row = col.row(align=True)
        row.prop(props, "color", index=2, slider=True, text="B")
        row.prop(props, "color", index=3, slider=True, text="A")
        col.separator()

        # Palette UI (user-editable)
        box = col.box()
        box.label(text="Palette:")
        prow = box.row(align=True)
        prow.operator("pigmi.add_palette", text="Add")
        # list of colors with per-item Use/Remove buttons
        for i, item in enumerate(context.scene.pigmi_palette):
            r = box.row(align=True)
            r.prop(item, "color", text="")
            sub = r.row(align=True)
            op_use = sub.operator("pigmi.use_palette_color", text="Use")
            op_use.idx = i
            op_rem = sub.operator("pigmi.remove_palette_item", text="Remove")
            op_rem.idx = i

        # Quick fills (White/Black/Transparent) - apply to selection, placed after palette
        fill_row = box.row(align=True)
        opw = fill_row.operator("pigmi.fill_all", text="White")
        opw.color = (1.0, 1.0, 1.0, 1.0)
        opb = fill_row.operator("pigmi.fill_all", text="Black")
        opb.color = (0.0, 0.0, 0.0, 1.0)
        opt = fill_row.operator("pigmi.fill_all", text="Transparent")
        opt.color = (1.0, 1.0, 1.0, 0.0)

        col.separator()
        col.prop(props, "auto_apply")
        col.prop(props, "preview_mode")
        col.separator()
        col.label(text="Falloff / Smoothness:")
        row = col.row(align=True)
        row.prop(props, "radius")
        row.prop(props, "iterations")
        col.prop(props, "falloff_power")
        col.separator()
        if props.preview_mode:
            # Apply (temporary, like sliders)
            col.operator("pigmi.apply_color", text="Apply")
            row2 = col.row(align=True)
            row2.operator("pigmi.commit_preview", text="Save")
            row2.operator("pigmi.cancel_preview", text="Restore")
        else:
            col.operator("pigmi.apply_color", text="Apply")

# registration
classes = (
    PigmiProps,
    PigmiPaletteItem,
    PIGMI_OT_add_palette,
    PIGMI_OT_remove_palette_item,
    PIGMI_OT_use_palette_color,
    PIGMI_OT_apply_color,
    PIGMI_OT_commit_preview,
    PIGMI_OT_cancel_preview,
    PIGMI_OT_fill_all,
    PIGMI_PT_panel,
)

def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.pigmi_props = PointerProperty(type=PigmiProps)
    bpy.types.Scene.pigmi_palette = CollectionProperty(type=PigmiPaletteItem)
    bpy.types.Scene.pigmi_palette_index = IntProperty(default=0)

def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    try:
        del bpy.types.Scene.pigmi_props
    except Exception:
        pass
    try:
        del bpy.types.Scene.pigmi_palette
        del bpy.types.Scene.pigmi_palette_index
    except Exception:
        pass

if __name__ == "__main__":
    register()
