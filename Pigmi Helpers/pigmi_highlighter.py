bl_info = {
    "name": "Pigmi: Highlighter",
    "author": "Pavlov Oleg (final)",
    "version": (1, 12, 2),
    "blender": (5, 0, 0),
    "location": "View3D > Tool",
    "description": "Pigmi Highlighter — vertex-color highlighter with palette and quick fills",
    "category": "Paint",
}

import bpy
import bmesh
from collections import deque
from bpy.props import (
    FloatVectorProperty, BoolProperty, IntProperty,
    PointerProperty, FloatProperty, CollectionProperty
)
from bpy.types import Panel, Operator, PropertyGroup

# ------------------------------
# Module-level in-memory backup
# ------------------------------
_PREVIEW_BACKUP = {}  # key: f"{obj.as_pointer()}_{me.as_pointer()}" -> {'domain':..., 'data':[...]}

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

def get_existing_color_attribute(mesh, name=None):
    attrs = getattr(mesh, "attributes", None)
    try:
        active = attrs.active_color if attrs is not None else None
    except Exception:
        active = None

    if name:
        ca = mesh.color_attributes.get(name)
        if ca and ca.domain in {'CORNER', 'POINT'}:
            return ca

    if active:
        name_active = getattr(active, "name", None) or str(active)
        ca = mesh.color_attributes.get(name_active)
        if ca and ca.domain in {'CORNER', 'POINT'}:
            return ca

    for ca in mesh.color_attributes:
        if ca.domain in {'CORNER', 'POINT'}:
            return ca

    return None

def create_color_attribute(mesh, name="Col", domain='CORNER'):
    ca = mesh.color_attributes.get(name)
    if ca:
        return ca
    try:
        ca = mesh.color_attributes.new(name=name, type='BYTE_COLOR', domain=domain)
    except Exception:
        try:
            vc = mesh.vertex_colors.new(name=name)
            ca = mesh.color_attributes.get(vc.name) if mesh.color_attributes else None
        except Exception:
            ca = None

    if ca is not None:
        try:
            for i, a in enumerate(mesh.attributes):
                if a.name == ca.name:
                    try:
                        mesh.attributes.active_color_index = i
                        mesh.attributes.active_color_name = ca.name
                        mesh.attributes.render_color_index = i
                    except Exception:
                        pass
                    break
            try:
                bpy.ops.geometry.color_attribute_render_set(name=ca.name)
            except Exception:
                pass
        except Exception:
            pass

    return ca

def get_or_create_color_attribute(mesh, name="Col", domain='CORNER'):
    ca = get_existing_color_attribute(mesh, name)
    if ca:
        try:
            for i, a in enumerate(mesh.attributes):
                if a.name == ca.name:
                    try:
                        mesh.attributes.active_color_index = i
                        mesh.attributes.active_color_name = ca.name
                        mesh.attributes.render_color_index = i
                    except Exception:
                        pass
                    break
            try:
                bpy.ops.geometry.color_attribute_render_set(name=ca.name)
            except Exception:
                pass
        except Exception:
            pass
        return ca
    return create_color_attribute(mesh, name=name, domain=domain)

def copy_color_attribute(mesh, src_name, dst_name):
    src = mesh.color_attributes.get(src_name)
    dst = mesh.color_attributes.get(dst_name)
    if not src or not dst or src.domain != dst.domain:
        return
    if src.domain == 'CORNER':
        for i in range(min(len(src.data), len(dst.data))):
            dst.data[i].color = src.data[i].color
    elif src.domain == 'POINT':
        for i in range(min(len(src.data), len(dst.data))):
            dst.data[i].color = src.data[i].color

# ------------------------------
# Robust backup / restore
# ------------------------------
def _backup_col_in_memory(obj, me):
    global _PREVIEW_BACKUP
    key = _make_key(obj, me)
    if key in _PREVIEW_BACKUP:
        #debug_print("_backup_col_in_memory: already have backup for key", key)
        return

    data = []
    domain = None
    bm = None
    created_bm = False
    try:
        if obj.mode == 'EDIT':
            bm = bmesh.from_edit_mesh(me)
            created_bm = False
        else:
            bm = bmesh.new()
            bm.from_mesh(me)
            created_bm = True

        try:
            bm.verts.ensure_lookup_table()
        except Exception:
            pass
        try:
            bm.faces.ensure_lookup_table()
        except Exception:
            pass

        ca = me.color_attributes.get("Col")
        if ca:
            domain = ca.domain
            if domain == 'CORNER':
                layer = bm.loops.layers.color.get("Col")
                if layer:
                    for face in bm.faces:
                        for loop in face.loops:
                            try:
                                c = loop[layer]
                                data.append((float(c[0]), float(c[1]), float(c[2]), float(c[3]) if len(c) > 3 else 1.0))
                            except Exception:
                                data.append((0.0,0.0,0.0,1.0))
            elif domain == 'POINT':
                layer = bm.verts.layers.color.get("Col")
                if layer:
                    for v in bm.verts:
                        try:
                            c = v[layer]
                            data.append((float(c[0]), float(c[1]), float(c[2]), float(c[3]) if len(c) > 3 else 1.0))
                        except Exception:
                            data.append((0.0,0.0,0.0,1.0))
    except Exception as e:
        #debug_print("_backup_col_in_memory: bmesh read failed:", e)
        data = []
    finally:
        try:
            if created_bm and bm is not None:
                bm.free()
        except Exception:
            pass

    if not data:
        ca = me.color_attributes.get("Col")
        if ca and len(ca.data) > 0:
            domain = ca.domain
            try:
                for item in ca.data:
                    col = tuple(float(x) for x in item.color)
                    if len(col) == 3:
                        col = (col[0], col[1], col[2], 1.0)
                    data.append(col)
            except Exception as e:
                #debug_print("_backup_col_in_memory: direct read failed:", e)
                data = []

    if not data:
        for other in me.color_attributes:
            if other.domain in {'CORNER','POINT'} and len(other.data) > 0:
                #debug_print("_backup_col_in_memory: falling back to other attribute", other.name)
                domain = other.domain
                try:
                    for item in other.data:
                        col = tuple(float(x) for x in item.color)
                        if len(col) == 3:
                            col = (col[0], col[1], col[2], 1.0)
                        data.append(col)
                except Exception as e:
                    #debug_print("_backup_col_in_memory: fallback read failed:", e)
                    data = []
                break

    if not data:
        try:
            if hasattr(me, "loops") and len(me.loops) > 0:
                domain = 'CORNER'
                n = len(me.loops)
            else:
                domain = 'POINT'
                n = len(me.vertices)
        except Exception:
            domain = 'CORNER'
            n = len(getattr(me, "loops", []))
        data = [(0.0,0.0,0.0,1.0)] * n
        #debug_print("_backup_col_in_memory: fallback default backup created, length", n)

    _PREVIEW_BACKUP[key] = {'domain': domain, 'data': data}
    #debug_print("_backup_col_in_memory: backup stored key", key, "domain", domain, "len", len(data))


def _overwrite_backup_with_current(obj, me):
    global _PREVIEW_BACKUP
    key = _make_key(obj, me)

    ca = me.color_attributes.get("Col")
    if ca and len(ca.data) > 0:
        data = []
        domain = ca.domain
        try:
            for item in ca.data:
                col = tuple(float(x) for x in item.color)
                if len(col) == 3:
                    col = (col[0], col[1], col[2], 1.0)
                data.append(col)
            _PREVIEW_BACKUP[key] = {'domain': domain, 'data': data}
            #debug_print("_overwrite_backup_with_current: direct read wrote backup key", key, "len", len(data))
            return
        except Exception as e:
            debug_print("_overwrite_backup_with_current: direct read failed:", e)

    bm = None
    created_bm = False
    try:
        if obj.mode == 'EDIT':
            bm = bmesh.from_edit_mesh(me)
            created_bm = False
        else:
            bm = bmesh.new()
            bm.from_mesh(me)
            created_bm = True

        try:
            bm.verts.ensure_lookup_table()
        except Exception:
            pass
        try:
            bm.faces.ensure_lookup_table()
        except Exception:
            pass

        data = []
        domain = (ca.domain if ca else ('CORNER' if len(getattr(me, "loops", [])) > 0 else 'POINT'))

        if domain == 'CORNER':
            layer = bm.loops.layers.color.get("Col")
            if layer:
                for face in bm.faces:
                    for loop in face.loops:
                        try:
                            c = loop[layer]
                            data.append((float(c[0]), float(c[1]), float(c[2]), float(c[3]) if len(c) > 3 else 1.0))
                        except Exception:
                            data.append((0.0, 0.0, 0.0, 1.0))
        else:
            layer = bm.verts.layers.color.get("Col")
            if layer:
                for v in bm.verts:
                    try:
                        c = v[layer]
                        data.append((float(c[0]), float(c[1]), float(c[2]), float(c[3]) if len(c) > 3 else 1.0))
                    except Exception:
                        data.append((0.0, 0.0, 0.0, 1.0))

        if created_bm and bm is not None:
            bm.free()

        if data:
            _PREVIEW_BACKUP[key] = {'domain': domain, 'data': data}
            #debug_print("_overwrite_backup_with_current: bmesh read wrote backup key", key, "len", len(data))
            return
        else:
            debug_print("_overwrite_backup_with_current: bmesh read produced no data for key", key)
    except Exception as e:
        #debug_print("_overwrite_backup_with_current: bmesh fallback failed:", e)
        try:
            if created_bm and bm is not None:
                bm.free()
        except Exception:
            pass

    try:
        if hasattr(me, "loops") and len(me.loops) > 0:
            domain = 'CORNER'
            n = len(me.loops)
        else:
            domain = 'POINT'
            n = len(me.vertices)
    except Exception:
        domain = 'CORNER'
        n = len(getattr(me, "loops", []))
    data = [(0.0, 0.0, 0.0, 1.0)] * n
    _PREVIEW_BACKUP[key] = {'domain': domain, 'data': data}
    #debug_print("_overwrite_backup_with_current: wrote fallback backup for key", key, "len", n)


def _restore_col_from_memory(obj, me):
    global _PREVIEW_BACKUP
    key = _make_key(obj, me)
    if key not in _PREVIEW_BACKUP:
        #debug_print("_restore_col_from_memory: no backup for key", key)
        return False
    backup = _PREVIEW_BACKUP[key]
    domain = backup.get('domain', 'CORNER')
    data = backup.get('data', [])
    ca = get_or_create_color_attribute(me, name="Col", domain=domain)
    if not ca:
        #debug_print("_restore_col_from_memory: failed to get/create Col")
        return False

    try:
        if len(ca.data) >= len(data) and len(data) > 0:
            n = min(len(ca.data), len(data))
            for i in range(n):
                ca.data[i].color = data[i]
            #debug_print("_restore_col_from_memory: direct write restored", me.name, "written=", n, "key=", key)
            me.update()
            try:
                for area in bpy.context.screen.areas:
                    if area.type == 'VIEW_3D':
                        area.tag_redraw()
            except Exception:
                pass
            return True
    except Exception as e:
        debug_print("_restore_col_from_memory: direct write failed:", e)

    bm = None
    created_bm = False
    try:
        if obj.mode == 'EDIT':
            bm = bmesh.from_edit_mesh(me)
            created_bm = False
        else:
            bm = bmesh.new()
            bm.from_mesh(me)
            created_bm = True

        try:
            bm.verts.ensure_lookup_table()
        except Exception:
            pass
        try:
            bm.faces.ensure_lookup_table()
        except Exception:
            pass

        if domain == 'CORNER':
            layer = bm.loops.layers.color.get(ca.name)
            if layer is None:
                layer = bm.loops.layers.color.new(ca.name)
            idx = 0
            count = 0
            for face in bm.faces:
                for loop in face.loops:
                    if idx < len(data):
                        loop[layer] = data[idx]
                        count += 1
                    idx += 1
            #debug_print("_restore_col_from_memory: bmesh wrote CORNER entries=", count, "key=", key)
        else:
            layer = bm.verts.layers.color.get(ca.name)
            if layer is None:
                layer = bm.verts.layers.color.new(ca.name)
            count = 0
            for i, v in enumerate(bm.verts):
                if i < len(data):
                    v[layer] = data[i]
                    count += 1
            #debug_print("_restore_col_from_memory: bmesh wrote POINT entries=", count, "key=", key)

        if obj.mode == 'EDIT':
            bmesh.update_edit_mesh(me, loop_triangles=False, destructive=False)
        else:
            bm.to_mesh(me)
            bm.free()
        me.update()
        try:
            for area in bpy.context.screen.areas:
                if area.type == 'VIEW_3D':
                    area.tag_redraw()
        except Exception:
            pass
        return True
    except Exception as e:
        #debug_print("_restore_col_from_memory: bmesh write failed:", e)
        try:
            if created_bm and bm is not None:
                bm.free()
        except Exception:
            pass

    #debug_print("_restore_col_from_memory: failed to restore for key", key)
    return False

def _clear_backup(obj, me):
    global _PREVIEW_BACKUP
    key = _make_key(obj, me)
    if key in _PREVIEW_BACKUP:
        del _PREVIEW_BACKUP[key]
        #debug_print("_clear_backup: cleared key", key)

# ------------------------------
# Preview helpers: enable/disable
# ------------------------------
def _preview_enable(obj, me):
    try:
        _backup_col_in_memory(obj, me)
    except Exception as e:
        debug_print("_preview_enable: backup ensure failed:", e)
    try:
        main_ca = get_or_create_color_attribute(me, "Col")
        if main_ca:
            for i, a in enumerate(me.attributes):
                if a.name == main_ca.name:
                    try:
                        me.attributes.active_color_index = i
                        me.attributes.active_color_name = main_ca.name
                        me.attributes.render_color_index = i
                    except Exception:
                        pass
                    break
            try:
                bpy.ops.geometry.color_attribute_render_set(name=main_ca.name)
            except Exception:
                pass
    except Exception as e:
        debug_print("_preview_enable: set active failed:", e)
    try:
        for area in bpy.context.screen.areas:
            if area.type == 'VIEW_3D':
                area.tag_redraw()
    except Exception:
        pass


def _preview_disable(obj, me, clear_backup=True):
    try:
        restored = _restore_col_from_memory(obj, me)
        #debug_print("_preview_disable: restored:", restored, "key:", _make_key(obj, me))
    except Exception as e:
        debug_print("_preview_disable: restore failed:", e)
    if clear_backup:
        try:
            _clear_backup(obj, me)
            #debug_print("_preview_disable: backup cleared key:", _make_key(obj, me))
        except Exception as e:
            debug_print("_preview_disable: clear backup failed:", e)
    try:
        main_ca = get_existing_color_attribute(me, "Col")
        if main_ca:
            for i, a in enumerate(me.attributes):
                if a.name == main_ca.name:
                    try:
                        me.attributes.active_color_index = i
                        me.attributes.active_color_name = main_ca.name
                        me.attributes.render_color_index = i
                    except Exception:
                        pass
                    break
            try:
                bpy.ops.geometry.color_attribute_render_set(name=main_ca.name)
            except Exception:
                pass
    except Exception as e:
        debug_print("_preview_disable: set active failed:", e)
    try:
        for area in bpy.context.screen.areas:
            if area.type == 'VIEW_3D':
                area.tag_redraw()
    except Exception:
        pass

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
    n = len(bm.verts)
    INF = 10**9
    dist = [INF] * n
    dq = deque()
    for vi in selected_vertices_idx:
        if 0 <= vi < n:
            dist[vi] = 0
            dq.append(vi)
    while dq:
        v_idx = dq.popleft()
        v = bm.verts[v_idx]
        for e in v.link_edges:
            other = e.other_vert(v)
            oi = other.index
            if dist[oi] > dist[v_idx] + 1:
                dist[oi] = dist[v_idx] + 1
                dq.append(oi)
    weights = [0.0] * n
    if radius <= 0:
        for i in range(n):
            weights[i] = 1.0 if dist[i] == 0 else 0.0
    else:
        for i in range(n):
            if dist[i] <= radius:
                linear = dist[i] / max(1e-6, radius)
                falloff = (1.0 - linear) ** falloff_power
                weights[i] = max(0.0, falloff)
            else:
                weights[i] = 0.0
    for _ in range(max(0, iterations)):
        neww = weights.copy()
        for v in bm.verts:
            total = weights[v.index]
            count = 1
            for e in v.link_edges:
                other = e.other_vert(v)
                total += weights[other.index]
                count += 1
            if count > 0:
                neww[v.index] = total / count
        weights = neww
    for i in range(len(weights)):
        if weights[i] < 0.0: weights[i] = 0.0
        if weights[i] > 1.0: weights[i] = 1.0
    return weights

# ------------------------------
# Core: apply + diagnostics
# ------------------------------
def set_colors_on_mesh(context, rgba, radius, iterations, falloff_power, preview_mode=False):
    obj = context.object
    if not obj or obj.type != 'MESH':
        #debug_print("No active mesh object.")
        return

    me = obj.data
    main_name = "Col"

    if preview_mode:
        try:
            restored = _restore_col_from_memory(obj, me)
            #debug_print("set_colors_on_mesh: restored before apply:", restored, "key:", _make_key(obj, me))
        except Exception as e:
            debug_print("set_colors_on_mesh: restore before apply failed:", e)

    ca = get_or_create_color_attribute(me, name=main_name)
    if not ca:
        #debug_print("No color attribute available.")
        return

    #debug_print("Applying to attribute:", ca.name, "domain:", ca.domain, "preview:", preview_mode)

    was_edit = (obj.mode == 'EDIT')
    if was_edit:
        bm = bmesh.from_edit_mesh(me)
    else:
        bm = bmesh.new()
        bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    domain = ca.domain

    if domain == 'CORNER':
        layer = bm.loops.layers.color.get(ca.name)
        if layer is None:
            layer = bm.loops.layers.color.new(ca.name)
        sel_mode = detect_selection_mode(context)
        sel_verts = [v.index for v in bm.verts if v.select]
        sel_edges = [e.index for e in bm.edges if e.select]
        sel_faces = [f.index for f in bm.faces if f.select]

        if sel_mode == 'FACE':
            if sel_faces:
                for fi in sel_faces:
                    face = bm.faces[fi]
                    for loop in face.loops:
                        loop[layer] = (float(rgba[0]), float(rgba[1]), float(rgba[2]), float(rgba[3]))
                #debug_print("Wrote face colors to BMesh layer", ca.name)
        else:
            if sel_mode == 'EDGE':
                if sel_edges:
                    selected_vertices = set()
                    for ei in sel_edges:
                        e = bm.edges[ei]
                        selected_vertices.add(e.verts[0].index)
                        selected_vertices.add(e.verts[1].index)
                    sel_verts_list = list(selected_vertices)
                else:
                    sel_verts_list = []
            else:
                sel_verts_list = sel_verts

            if sel_verts_list:
                weights = compute_vertex_weights_with_radius(bm, sel_verts_list, radius, iterations, falloff_power)
                for face in bm.faces:
                    for loop in face.loops:
                        v_idx = loop.vert.index
                        w = weights[v_idx]
                        cur = loop[layer]
                        cur_col = (float(cur[0]), float(cur[1]), float(cur[2]), float(cur[3]))
                        res = (
                            cur_col[0] * (1.0 - w) + float(rgba[0]) * w,
                            cur_col[1] * (1.0 - w) + float(rgba[1]) * w,
                            cur_col[2] * (1.0 - w) + float(rgba[2]) * w,
                            cur_col[3] * (1.0 - w) + float(rgba[3]) * w,
                        )
                        loop[layer] = res
                #debug_print("Wrote blended loop colors to BMesh layer", ca.name)

    elif domain == 'POINT':
        layer = bm.verts.layers.color.get(ca.name)
        if layer is None:
            layer = bm.verts.layers.color.new(ca.name)
        sel_mode = detect_selection_mode(context)
        sel_verts = [v.index for v in bm.verts if v.select]
        sel_edges = [e.index for e in bm.edges if e.select]
        sel_faces = [f.index for f in bm.faces if f.select]

        if sel_mode == 'FACE':
            if sel_faces:
                for fi in sel_faces:
                    face = bm.faces[fi]
                    for vert in face.verts:
                        vert[layer] = (float(rgba[0]), float(rgba[1]), float(rgba[2]), float(rgba[3]))
                #debug_print("Wrote face->vertex colors to BMesh layer", ca.name)
        else:
            if sel_mode == 'EDGE':
                if sel_edges:
                    selected_vertices = set()
                    for ei in sel_edges:
                        e = bm.edges[ei]
                        selected_vertices.add(e.verts[0].index)
                        selected_vertices.add(e.verts[1].index)
                    sel_verts_list = list(selected_vertices)
                else:
                    sel_verts_list = []
            else:
                sel_verts_list = sel_verts

            if sel_verts_list:
                weights = compute_vertex_weights_with_radius(bm, sel_verts_list, radius, iterations, falloff_power)
                for vert in bm.verts:
                    v_idx = vert.index
                    w = weights[v_idx]
                    cur = vert[layer]
                    cur_col = (float(cur[0]), float(cur[1]), float(cur[2]), float(cur[3]))
                    res = (
                        cur_col[0] * (1.0 - w) + float(rgba[0]) * w,
                        cur_col[1] * (1.0 - w) + float(rgba[1]) * w,
                        cur_col[2] * (1.0 - w) + float(rgba[2]) * w,
                        cur_col[3] * (1.0 - w) + float(rgba[3]) * w,
                    )
                    vert[layer] = res
                #debug_print("Wrote blended vertex colors to BMesh layer", ca.name)
    else:
        #debug_print("Unsupported attribute domain:", domain)
        if not (obj.mode == 'EDIT'):
            try:
                bm.free()
            except Exception:
                pass
        return

    if obj.mode == 'EDIT':
        bmesh.update_edit_mesh(me, loop_triangles=False, destructive=False)
    else:
        bm.to_mesh(me)
        bm.free()
    me.update()

    try:
        idx = None
        for i, a in enumerate(me.attributes):
            if a.name == main_name:
                idx = i
                break
        if idx is not None:
            try:
                me.attributes.active_color_index = idx
                me.attributes.active_color_name = main_name
                me.attributes.render_color_index = idx
            except Exception:
                pass
        try:
            bpy.ops.geometry.color_attribute_render_set(name=main_name)
        except Exception:
            pass
    except Exception:
        pass

    try:
        for area in bpy.context.screen.areas:
            if area.type == 'VIEW_3D':
                area.tag_redraw()
    except Exception:
        pass

    #debug_print("Apply finished. Showing attribute:", main_name)

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
            # set main color (updates sliders)
            try:
                props.color = rgba
            except Exception:
                pass
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
        self.report({'INFO'}, "Pigmi: Color applied (check system console for diagnostics)")
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
            if obj.mode == 'EDIT':
                try:
                    bm_edit = bmesh.from_edit_mesh(me)
                    bmesh.update_edit_mesh(me, loop_triangles=False, destructive=False)
                except Exception as e:
                    debug_print("commit_preview: flush editmesh failed:", e)
            else:
                try:
                    me.update()
                except Exception as e:
                    debug_print("commit_preview: me.update failed:", e)
        except Exception as e:
            debug_print("commit_preview: ensure mesh up-to-date failed:", e)

        try:
            _overwrite_backup_with_current(obj, me)
            #debug_print("commit_preview: backup overwritten for key:", _make_key(obj, me))
        except Exception as e:
            #debug_print("commit_preview: _overwrite_backup_with_current failed:", e)
            self.report({'WARNING'}, "Pigmi: Failed to overwrite preview backup (see console).")
            return {'CANCELLED'}

        try:
            ok = _restore_col_from_memory(obj, me)
            #debug_print("commit_preview: restore after overwrite returned:", ok, "key:", _make_key(obj, me))
        except Exception as e:
            #debug_print("commit_preview: restore after overwrite failed:", e)
            self.report({'WARNING'}, "Pigmi: Failed to restore after backup (see console).")
            return {'CANCELLED'}

        try:
            props.preview_mode = True
        except Exception:
            pass

        try:
            main_ca = get_existing_color_attribute(me, "Col")
            if main_ca:
                for i, a in enumerate(me.attributes):
                    if a.name == main_ca.name:
                        me.attributes.active_color_index = i
                        me.attributes.active_color_name = main_ca.name
                        me.attributes.render_color_index = i
                        break
                try:
                    bpy.ops.geometry.color_attribute_render_set(name=main_ca.name)
                except Exception:
                    pass
        except Exception:
            pass

        for area in context.screen.areas:
            if area.type == 'VIEW_3D':
                area.tag_redraw()

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
        for area in context.screen.areas:
            if area.type == 'VIEW_3D':
                area.tag_redraw()
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
        # also update main color sliders
        try:
            props.color = rgba
        except Exception:
            pass
        obj = context.object
        if not obj or obj.type != 'MESH':
            self.report({'WARNING'}, "Pigmi: No mesh to fill.")
            return {'CANCELLED'}
        # Use existing pipeline so selection mode, preview, and blending behave the same
        try:
            set_colors_on_mesh(context, rgba, radius=0.0, iterations=0, falloff_power=1.0, preview_mode=props.preview_mode)
        except Exception as e:
            #debug_print("fill_all: set_colors_on_mesh failed:", e)
            self.report({'WARNING'}, "Pigmi: Fill failed (see console)")
            return {'CANCELLED'}
        self.report({'INFO'}, "Pigmi: Filled selection")
        return {'FINISHED'}

def pigmi_param_update(self, context):
    props = context.scene.pigmi_props
    if not context.object or context.object.type != 'MESH':
        return
    rgba = tuple(props.color)
    if props.preview_mode:
        if props.auto_apply:
            set_colors_on_mesh(context, rgba, props.radius, props.iterations, props.falloff_power, preview_mode=True)
    else:
        if props.auto_apply:
            set_colors_on_mesh(context, rgba, props.radius, props.iterations, props.falloff_power, preview_mode=False)

def pigmi_preview_toggle(self, context):
    props = context.scene.pigmi_props
    obj = context.object
    if not obj or obj.type != 'MESH':
        #debug_print("pigmi_preview_toggle: no active mesh")
        return
    me = obj.data
    if props.preview_mode:
        _preview_enable(obj, me)
        #debug_print("Preview enabled; backup key:", _make_key(obj, me))
    else:
        _preview_disable(obj, me, clear_backup=True)
        #debug_print("Preview disabled; restored and cleared key:", _make_key(obj, me))

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
