bl_info = {
    "name": "Pigmi: Face to Face",
    "author": "Oleg Pavlov",
    "version": (1, 7, 18),
    "blender": (4, 3, 0),
    "location": "View3D > Tool Shelf > Pigmi: Face to Face",
    "description": (
        "Saves the selected mesh part (using a base element – face or edge) and attaches it to a target element.\n"
        "Parameters (Rotation Offset, Flip, Scale) can be adjusted via the Adjust Last Operation panel.\n"
        "Subsequent calls always use the originally saved local coordinates.\n"
        "Normals are updated without switching modes."
    ),
    "category": "Mesh",
}

import bpy, bmesh, math, mathutils
from mathutils import Vector, Matrix

# Global storage for the saved mesh part and keymaps
saved_state = {}
addon_keymaps = []

class MESH_OT_snap_mesh_piece(bpy.types.Operator):
    """Saves the selected mesh part and attaches it to the target element (face or edge)"""
    bl_idname = "mesh.snap_mesh_piece"
    bl_label = "Pigmi: Face to Face"
    bl_options = {'REGISTER', 'UNDO'}

    rot_offset: bpy.props.FloatProperty(
         name="Rotation Offset",
         description="Additional rotation (for faces – around the normal, for edges – around the edge)",
         default=0.0,
         subtype='ANGLE'
    )
    flip: bpy.props.BoolProperty(
         name="Flip",
         description=("For faces: if disabled, rotates 180° around the base tangent.\n"
                      "For edges: if enabled, mirrors along the X-axis of the target edge."),
         default=False
    )
    restore_selection: bpy.props.BoolProperty(
         name="Restore Original Selection",
         description="Restore the original selection after attaching (for edges – only selection; active element is not supported).",
         default=False
    )
    duplicate_to_faces: bpy.props.BoolProperty(
         name="Duplicate to Target Elements",
         description=("Instead of moving the original, create copies on each selected target element. "
                      "Each element receives its own transformation."),
         default=False
    )
    scale_factor: bpy.props.FloatProperty(
         name="Scale",
         description="Scale factor for the mesh part (1.0 = original size)",
         default=1.0
    )
    perp_flip: bpy.props.BoolProperty(
         name="Perp Flip",
         description="Mirror the part along the perpendicular axis when attaching edges",
         default=False
    )

    def update_view(self):
        """Update the view without switching modes."""
        bmesh.update_edit_mesh(bpy.context.active_object.data)
        bm = bmesh.from_edit_mesh(bpy.context.active_object.data)
        bm.normal_update()
        if bpy.context.area:
            bpy.context.area.tag_redraw()

    def execute(self, context):
        global saved_state
        obj = context.active_object
        if not (obj and obj.type == 'MESH'):
            self.report({'ERROR'}, "Active object is not a mesh")
            return {'CANCELLED'}
        if context.mode != 'EDIT_MESH':
            self.report({'ERROR'}, "Operation is available only in Edit mode")
            return {'CANCELLED'}

        bm = bmesh.from_edit_mesh(obj.data)
        bm.faces.ensure_lookup_table()
        bm.edges.ensure_lookup_table()

        # First call: save the selected mesh part.
        if not saved_state:
            select_mode = context.tool_settings.mesh_select_mode  # (vertex, edge, face)
            active_elem = None
            elem_type = None
            if select_mode[1] and not select_mode[2]:
                for elem in reversed(bm.select_history):
                    if isinstance(elem, bmesh.types.BMEdge):
                        active_elem = elem
                        elem_type = "EDGE"
                        break
                if not active_elem:
                    self.report({'ERROR'}, "No active edge found in selection history")
                    return {'CANCELLED'}
            else:
                if bm.faces.active:
                    active_elem = bm.faces.active
                    elem_type = "FACE"
                else:
                    for elem in reversed(bm.select_history):
                        if isinstance(elem, bmesh.types.BMEdge):
                            active_elem = elem
                            elem_type = "EDGE"
                            break
                    if not active_elem:
                        self.report({'ERROR'}, "No active element (face or edge) found")
                        return {'CANCELLED'}

            if elem_type == "FACE":
                sel_faces = [f for f in bm.faces if f.select]
                if not sel_faces:
                    self.report({'ERROR'}, "No selected faces")
                    return {'CANCELLED'}
                vertex_indices = set()
                for f in sel_faces:
                    for v in f.verts:
                        vertex_indices.add(v.index)
                orig_positions = {v.index: v.co.copy() for v in bm.verts if v.index in vertex_indices}
                base_center = active_elem.calc_center_median()
                base_normal = active_elem.normal.copy()
                if base_normal.length > 1e-6:
                    base_normal.normalize()
                else:
                    base_normal = Vector((0, 0, 1))
                if active_elem.verts:
                    tangent = (active_elem.verts[0].co - base_center).copy()
                    if tangent.length < 1e-6:
                        tangent = base_normal.cross(Vector((0, 0, 1)))
                        if tangent.length < 1e-6:
                            tangent = base_normal.cross(Vector((0, 1, 0)))
                    tangent.normalize()
                else:
                    tangent = Vector((1, 0, 0))
                saved_state = {
                    "object_name": obj.name,
                    "element_type": "FACE",
                    "active_face_index": active_elem.index,
                    "vertex_indices": list(vertex_indices),
                    "face_indices": [f.index for f in sel_faces],
                    "orig_positions": orig_positions,
                    "base_center": base_center.copy(),
                    "base_normal": base_normal.copy(),
                    "base_tangent": tangent.copy()
                }
                self.report({'INFO'}, "Mesh part saved from FACE. Now select a target element and run the operator again.")
            else:  # EDGE
                sel_edges = [e for e in bm.edges if e.select]
                if not sel_edges:
                    self.report({'ERROR'}, "No selected edges")
                    return {'CANCELLED'}
                vertex_indices = set()
                for edge in sel_edges:
                    for v in edge.verts:
                        vertex_indices.add(v.index)
                orig_positions = {v.index: v.co.copy() for v in bm.verts if v.index in vertex_indices}
                sel_faces = [f for f in bm.faces if f.select]
                if not sel_faces:
                    sel_faces = [f for f in bm.faces if any(e in sel_edges for e in f.edges)]
                v0 = active_elem.verts[0].co
                v1 = active_elem.verts[1].co
                base_center = (v0 + v1) * 0.5
                base_tangent = (v1 - v0).normalized()
                if active_elem.link_faces:
                    avg_normal = Vector((0, 0, 0))
                    for f in active_elem.link_faces:
                        avg_normal += f.normal
                    avg_normal /= len(active_elem.link_faces)
                    avg_normal -= avg_normal.project(base_tangent)
                    if avg_normal.length < 1e-6:
                        avg_normal = Vector((0, 0, 1))
                    else:
                        avg_normal.normalize()
                    base_normal = avg_normal.copy()
                else:
                    base_normal = Vector((0, 0, 1))
                    if abs(base_normal.dot(base_tangent)) > 0.9:
                        base_normal = Vector((0, 1, 0))
                base_binormal = base_normal.cross(base_tangent)
                saved_state = {
                    "object_name": obj.name,
                    "element_type": "EDGE",
                    "active_edge_index": active_elem.index,
                    "vertex_indices": list(vertex_indices),
                    "edge_indices": [e.index for e in sel_edges],
                    "face_indices": [f.index for f in sel_faces],
                    "orig_positions": orig_positions,
                    "base_center": base_center.copy(),
                    "base_tangent": base_tangent.copy(),
                    "base_normal": base_normal.copy(),
                    "base_binormal": base_binormal.copy()
                }
                self.report({'INFO'}, "Mesh part saved from EDGE. Now select a target element and run the operator again.")
            return {'FINISHED'}

        # Second call: perform the attachment/duplication.
        if self.duplicate_to_faces:
            # Reset positions to original.
            for v in bm.verts:
                if v.index in saved_state["vertex_indices"]:
                    v.co = saved_state["orig_positions"][v.index].copy()
            bmesh.update_edit_mesh(obj.data)

            if saved_state["element_type"] == "FACE":
                target_elements = [f for f in bm.faces if f.select and f.index not in saved_state["face_indices"]]
                if not target_elements:
                    self.report({'ERROR'}, "No target face selected (excluding the saved part)")
                    return {'CANCELLED'}
                all_dup_faces = []
                for target_face in target_elements:
                    target_center = target_face.calc_center_median()
                    target_normal = target_face.normal.copy()
                    if target_normal.length > 1e-6:
                        target_normal.normalize()
                    else:
                        target_normal = Vector((0, 0, 1))
                    if target_face.verts:
                        target_tangent = (target_face.verts[0].co - target_center).copy()
                        if target_tangent.length < 1e-6:
                            target_tangent = target_normal.cross(Vector((0, 0, 1)))
                            if target_tangent.length < 1e-6:
                                target_tangent = target_normal.cross(Vector((0, 1, 0)))
                        target_tangent.normalize()
                    else:
                        target_tangent = Vector((1, 0, 0))
                    rot_mat = Matrix.Rotation(self.rot_offset, 3, target_normal)
                    target_tangent = (rot_mat @ target_tangent).normalized()
                    target_binormal = target_normal.cross(target_tangent)
                    if target_binormal.length < 1e-6:
                        target_binormal = Vector((0, 0, 1))
                    else:
                        target_binormal.normalize()
                    R_target = Matrix((target_tangent, target_binormal, target_normal)).transposed()
                    if self.flip:
                        R_target = R_target @ Matrix.Diagonal((-1, 1, 1))
                    source_tangent = saved_state["base_tangent"].copy()
                    source_normal = saved_state["base_normal"].copy()
                    if not self.flip:
                        flip_mat = Matrix.Rotation(math.radians(180), 3, source_tangent)
                        source_normal = flip_mat @ source_normal
                    source_binormal = source_normal.cross(source_tangent)
                    R_source = Matrix((source_tangent, source_binormal, source_normal)).transposed()
                    R = R_target @ R_source.inverted()
                    T = target_center - (R @ saved_state["base_center"])
                    M = Matrix.Translation(T) @ R.to_4x4()
                    scale_matrix = Matrix.Translation(target_center) @ Matrix.Scale(self.scale_factor, 4) @ Matrix.Translation(-target_center)
                    M_new = scale_matrix @ M

                    saved_verts = [v for v in bm.verts if v.index in saved_state["vertex_indices"]]
                    saved_faces = [f for f in bm.faces if f.index in saved_state["face_indices"]]
                    geom_to_duplicate = saved_verts + saved_faces
                    dup_result = bmesh.ops.duplicate(bm, geom=geom_to_duplicate)
                    dup_geom = dup_result.get("geom_dup") or dup_result.get("geom", [])
                    dup_verts = [elem for elem in dup_geom if isinstance(elem, bmesh.types.BMVert)]
                    bmesh.ops.transform(bm, matrix=M_new, verts=dup_verts)
                    dup_faces = [elem for elem in dup_geom if isinstance(elem, bmesh.types.BMFace)]
                    for f in dup_faces:
                        f.select = True
                    all_dup_faces.extend(dup_faces)
                if self.restore_selection:
                    bpy.ops.mesh.select_all(action='DESELECT')
                    bm.faces.ensure_lookup_table()
                    for idx in saved_state.get("face_indices", []):
                        try:
                            bm.faces[idx].select = True
                        except Exception:
                            pass
                    bmesh.update_edit_mesh(obj.data)
                else:
                    for f in all_dup_faces:
                        f.select = False
                    for f in bm.faces:
                        if f.index in saved_state.get("face_indices", []):
                            f.select = False
                self.update_view()
                self.report({'INFO'}, "Mesh piece duplicates created on target face(s).")
                return {'FINISHED'}

            else:  # EDGE duplication
                target_elements = [e for e in bm.edges if e.select and e.index not in saved_state["edge_indices"]]
                if not target_elements:
                    self.report({'ERROR'}, "No target edge selected (excluding the saved part)")
                    return {'CANCELLED'}
                all_dup_faces = []
                for target_edge in target_elements:
                    v0 = target_edge.verts[0].co
                    v1 = target_edge.verts[1].co
                    target_center = (v0 + v1) * 0.5
                    target_tangent = (v1 - v0).normalized()
                    if target_edge.link_faces:
                        avg_normal = Vector((0, 0, 0))
                        for f in target_edge.link_faces:
                            avg_normal += f.normal
                        avg_normal /= len(target_edge.link_faces)
                        avg_normal -= avg_normal.project(target_tangent)
                        if avg_normal.length < 1e-6:
                            avg_normal = Vector((0, 0, 1))
                        else:
                            avg_normal.normalize()
                        target_normal = avg_normal.copy()
                    else:
                        target_normal = Vector((0, 0, 1))
                        if abs(target_normal.dot(target_tangent)) > 0.9:
                            target_normal = Vector((0, 1, 0))
                    rot_mat = Matrix.Rotation(self.rot_offset, 3, target_tangent)
                    target_normal = (rot_mat @ target_normal).normalized()
                    target_binormal = target_normal.cross(target_tangent)
                    if target_binormal.length < 1e-6:
                        target_binormal = Vector((0, 0, 1))
                    else:
                        target_binormal.normalize()
                    R_target_base = Matrix((target_tangent, target_binormal, target_normal)).transposed()
                    if self.flip:
                        R_target_base = R_target_base @ Matrix.Diagonal((-1, 1, 1))
                    source_tangent = saved_state["base_tangent"].copy()
                    source_normal = saved_state["base_normal"].copy()
                    # Recalculate the source binormal for consistent local axis
                    source_binormal = source_normal.cross(source_tangent)
                    R_source = Matrix((source_tangent, source_binormal, source_normal)).transposed()
                    R = R_target_base @ R_source.inverted()
                    T = target_center - (R @ saved_state["base_center"])
                    M0 = Matrix.Translation(T) @ R.to_4x4()
                    scale_matrix = Matrix.Translation(target_center) @ Matrix.Scale(self.scale_factor, 4) @ Matrix.Translation(-target_center)
                    if self.perp_flip:
                        mirror = (Matrix.Translation(target_center) @
                                  R_target_base.to_4x4() @ Matrix.Diagonal((1, -1, 1, 1)) @
                                  R_target_base.to_4x4().inverted() @ Matrix.Translation(-target_center))
                        M_new = scale_matrix @ (mirror @ M0)
                    else:
                        M_new = scale_matrix @ M0

                    saved_verts = [v for v in bm.verts if v.index in saved_state["vertex_indices"]]
                    saved_faces = [f for f in bm.faces if f.index in saved_state.get("face_indices", [])]
                    # Exclude saved edges from duplication – vertices and faces suffice.
                    geom_to_duplicate = saved_verts + saved_faces
                    dup_result = bmesh.ops.duplicate(bm, geom=geom_to_duplicate)
                    dup_geom = dup_result.get("geom_dup") or dup_result.get("geom", [])
                    dup_verts = [elem for elem in dup_geom if isinstance(elem, bmesh.types.BMVert)]
                    bmesh.ops.transform(bm, matrix=M_new, verts=dup_verts)
                    dup_faces = [elem for elem in dup_geom if isinstance(elem, bmesh.types.BMFace)]
                    for f in dup_faces:
                        f.select = True
                    all_dup_faces.extend(dup_faces)
                if self.restore_selection:
                    bpy.ops.mesh.select_all(action='DESELECT')
                    bm.faces.ensure_lookup_table()
                    for idx in saved_state.get("face_indices", []):
                        try:
                            bm.faces[idx].select = True
                        except Exception:
                            pass
                    bmesh.update_edit_mesh(obj.data)
                else:
                    for f in all_dup_faces:
                        f.select = False
                    for f in bm.faces:
                        if f.index in saved_state.get("face_indices", []):
                            f.select = False
                self.update_view()
                self.report({'INFO'}, "Mesh piece duplicates created on target edge(s).")
                return {'FINISHED'}

        else:
            # Non-duplicate mode – move the original saved mesh part.
            for v in bm.verts:
                if v.index in saved_state["vertex_indices"]:
                    v.co = saved_state["orig_positions"][v.index].copy()
            bmesh.update_edit_mesh(obj.data)

            if saved_state["element_type"] == "FACE":
                target_face = bm.faces.active
                for v in target_face.verts:
                    if v.index in saved_state["vertex_indices"]:
                        self.report({'ERROR'}, "Target face belongs to the saved part")
                        return {'CANCELLED'}
                target_center = target_face.calc_center_median()
                target_normal = target_face.normal.copy()
                if target_normal.length > 1e-6:
                    target_normal.normalize()
                else:
                    target_normal = Vector((0, 0, 1))
                if target_face.verts:
                    target_tangent = (target_face.verts[0].co - target_center).copy()
                    if target_tangent.length < 1e-6:
                        target_tangent = target_normal.cross(Vector((0, 0, 1)))
                        if target_tangent.length < 1e-6:
                            target_tangent = target_normal.cross(Vector((0, 1, 0)))
                    target_tangent.normalize()
                else:
                    target_tangent = Vector((1, 0, 0))
                rot_mat = Matrix.Rotation(self.rot_offset, 3, target_normal)
                target_tangent = (rot_mat @ target_tangent).normalized()
                target_binormal = target_normal.cross(target_tangent)
                if target_binormal.length < 1e-6:
                    target_binormal = Vector((0, 0, 1))
                else:
                    target_binormal.normalize()
                R_target = Matrix((target_tangent, target_binormal, target_normal)).transposed()
                source_tangent = saved_state["base_tangent"].copy()
                source_normal = saved_state["base_normal"].copy()
                if not self.flip:
                    flip_mat = Matrix.Rotation(math.radians(180), 3, source_tangent)
                    source_normal = flip_mat @ source_normal
                source_binormal = source_normal.cross(source_tangent)
                R_source = Matrix((source_tangent, source_binormal, source_normal)).transposed()
                R = R_target @ R_source.inverted()
                T = target_center - (R @ saved_state["base_center"])
                M = Matrix.Translation(T) @ R.to_4x4()
                scale_matrix = Matrix.Translation(target_center) @ Matrix.Scale(self.scale_factor, 4) @ Matrix.Translation(-target_center)
                M_new = scale_matrix @ M
                for v in bm.verts:
                    if v.index in saved_state["vertex_indices"]:
                        new_co = M_new @ saved_state["orig_positions"][v.index].to_4d()
                        v.co = new_co.to_3d()
                bmesh.update_edit_mesh(obj.data)
                bm.faces.ensure_lookup_table()
                if self.restore_selection:
                    bpy.ops.mesh.select_all(action='DESELECT')
                    for idx in saved_state.get("face_indices", []):
                        try:
                            bm.faces[idx].select = True
                        except Exception:
                            pass
                    if "active_face_index" in saved_state and saved_state["active_face_index"] < len(bm.faces):
                        bm.faces.active = bm.faces[saved_state["active_face_index"]]
                    bmesh.update_edit_mesh(obj.data)
                self.update_view()
                self.report({'INFO'}, "Mesh piece attached to target face.")
                return {'FINISHED'}

            else:  # EDGE (moving)
                target_edge = None
                for elem in reversed(bm.select_history):
                    if isinstance(elem, bmesh.types.BMEdge) and (elem.index not in saved_state.get("edge_indices", [])):
                        target_edge = elem
                        break
                if not target_edge:
                    self.report({'ERROR'}, "Target edge belongs to the saved part or is not selected")
                    return {'CANCELLED'}
                v0 = target_edge.verts[0].co
                v1 = target_edge.verts[1].co
                target_center = (v0 + v1) * 0.5
                target_tangent = (v1 - v0).normalized()
                if target_edge.link_faces:
                    avg_normal = Vector((0, 0, 0))
                    for f in target_edge.link_faces:
                        avg_normal += f.normal
                    avg_normal /= len(target_edge.link_faces)
                    avg_normal -= avg_normal.project(target_tangent)
                    if avg_normal.length < 1e-6:
                        avg_normal = Vector((0, 0, 1))
                    else:
                        avg_normal.normalize()
                    target_normal = avg_normal.copy()
                else:
                    target_normal = Vector((0, 0, 1))
                    if abs(target_normal.dot(target_tangent)) > 0.9:
                        target_normal = Vector((0, 1, 0))
                rot_mat = Matrix.Rotation(self.rot_offset, 3, target_tangent)
                target_normal = (rot_mat @ target_normal).normalized()
                target_binormal = target_normal.cross(target_tangent)
                if target_binormal.length < 1e-6:
                    target_binormal = Vector((0, 0, 1))
                else:
                    target_binormal.normalize()
                R_target_base = Matrix((target_tangent, target_binormal, target_normal)).transposed()
                if self.flip:
                    R_target_base = R_target_base @ Matrix.Diagonal((-1, 1, 1))
                source_tangent = saved_state["base_tangent"].copy()
                source_normal = saved_state["base_normal"].copy()
                source_binormal = saved_state["base_binormal"].copy()
                R_source = Matrix((source_tangent, source_binormal, source_normal)).transposed()
                R = R_target_base @ R_source.inverted()
                T = target_center - (R @ saved_state["base_center"])
                M0 = Matrix.Translation(T) @ R.to_4x4()
                scale_matrix = Matrix.Translation(target_center) @ Matrix.Scale(self.scale_factor, 4) @ Matrix.Translation(-target_center)
                if self.perp_flip:
                    mirror = (Matrix.Translation(target_center) @
                              R_target_base.to_4x4() @ Matrix.Diagonal((1, -1, 1, 1)) @
                              R_target_base.to_4x4().inverted() @ Matrix.Translation(-target_center))
                    M_new = scale_matrix @ (mirror @ M0)
                else:
                    M_new = scale_matrix @ M0
                for v in bm.verts:
                    if v.index in saved_state["vertex_indices"]:
                        v.co = (M_new @ saved_state["orig_positions"][v.index].to_4d()).to_3d()
                bmesh.update_edit_mesh(obj.data)
                if self.restore_selection:
                    bpy.ops.mesh.select_all(action='DESELECT')
                    bm.edges.ensure_lookup_table()
                    for idx in saved_state.get("edge_indices", []):
                        try:
                            bm.edges[idx].select = True
                        except Exception:
                            pass
                    bmesh.update_edit_mesh(obj.data)
                self.update_view()
                self.report({'INFO'}, "Mesh piece attached to target edge.")
                return {'FINISHED'}

def register():
    bpy.utils.register_class(MESH_OT_snap_mesh_piece)
    bpy.utils.register_class(MESH_OT_cancel_snap_mesh_piece)
    bpy.utils.register_class(VIEW3D_PT_snap_mesh_piece)
    wm = bpy.context.window_manager
    km = wm.keyconfigs.addon.keymaps.new(name='Mesh', space_type='EMPTY')
    kmi = km.keymap_items.new("mesh.snap_mesh_piece", type='F', value='PRESS', ctrl=False, shift=True)
    addon_keymaps.append((km, kmi))
    km2 = wm.keyconfigs.addon.keymaps.new(name='Mesh', space_type='EMPTY')
    kmi2 = km2.keymap_items.new("mesh.cancel_snap_mesh_piece", type='F', value='PRESS', ctrl=True, shift=True)
    addon_keymaps.append((km2, kmi2))
    
    bpy.types.Scene.f2f_restore_selection = bpy.props.BoolProperty(
         name="Restore Original Selection",
         description="Restore the original selection after attaching",
         default=False
    )
    bpy.types.Scene.f2f_duplicate_to_faces = bpy.props.BoolProperty(
         name="Duplicate to Target Elements",
         description="Create copies on each target element instead of moving the original",
         default=False
    )
    bpy.types.Scene.f2f_flip = bpy.props.BoolProperty(
         name="Flip",
         description=("For faces: if disabled, rotates 180°;\n"
                      "For edges: if enabled, mirrors along the X-axis of the target edge."),
         default=False
    )
    bpy.types.Scene.f2f_scale_factor = bpy.props.FloatProperty(
         name="Scale",
         description="Scale factor for the mesh part (1.0 = original size)",
         default=1.0
    )
    bpy.types.Scene.f2f_perp_flip = bpy.props.BoolProperty(
         name="Perp Flip",
         description="Mirror the mesh part along the perpendicular axis when attaching edges",
         default=False
    )

def unregister():
    bpy.utils.unregister_class(MESH_OT_snap_mesh_piece)
    bpy.utils.unregister_class(MESH_OT_cancel_snap_mesh_piece)
    bpy.utils.unregister_class(VIEW3D_PT_snap_mesh_piece)
    wm = bpy.context.window_manager
    for km, kmi in addon_keymaps:
        km.keymap_items.remove(kmi)
    addon_keymaps.clear()
    del bpy.types.Scene.f2f_restore_selection
    del bpy.types.Scene.f2f_duplicate_to_faces
    del bpy.types.Scene.f2f_flip
    del bpy.types.Scene.f2f_scale_factor
    del bpy.types.Scene.f2f_perp_flip

class MESH_OT_cancel_snap_mesh_piece(bpy.types.Operator):
    bl_idname = "mesh.cancel_snap_mesh_piece"
    bl_label = "Cancel Snap"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        global saved_state
        if saved_state:
            saved_state.clear()
            self.report({'INFO'}, "Session ended - saved state cleared.")
        else:
            self.report({'WARNING'}, "No saved mesh piece to cancel.")
        if bpy.context.area:
            bpy.context.area.tag_redraw()
        return {'FINISHED'}

class VIEW3D_PT_snap_mesh_piece(bpy.types.Panel):
    bl_label = "Pigmi: Face to Face"
    bl_idname = "VIEW3D_PT_snap_mesh_piece"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Tool"

    def draw(self, context):
        layout = self.layout
        layout.operator("mesh.snap_mesh_piece", text="Snap Mesh Piece (Shift+F)")
        if saved_state:
            layout.operator("mesh.cancel_snap_mesh_piece", text="Cancel Snap (Shift+Ctrl+F)")

if __name__ == "__main__":
    register()
