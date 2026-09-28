"""Select exactly the element used by the Pigmi hover picker."""
import bpy
import bmesh
from mathutils import Vector
from .cursor import Cursor


def select_hit(cursor, target, toggle=False):
    bm=cursor.bm
    deselect=target is not None and target.select and toggle
    if not toggle:
        for seq in (bm.faces,bm.edges,bm.verts):
            for element in seq:
                element.select=False
        bm.select_history.clear()
    if target is not None:
        target.select_set(not deselect)
        if deselect:
            # Deselecting a lower-dimensional element invalidates its selected parents.
            for face in bm.faces:
                if face.select and not all(v.select for v in face.verts):
                    face.select=False
            for edge in bm.edges:
                if edge.select and not all(v.select for v in edge.verts):
                    edge.select=False
            bm.select_history.discard(target)
        else:
            bm.select_history.discard(target)
            bm.select_history.add(target)
            if isinstance(target,bmesh.types.BMFace):
                bm.faces.active=target
    bmesh.update_edit_mesh(cursor.obj.data,loop_triangles=False,destructive=False)


class PIGMI_OT_pick_drag(bpy.types.Operator):
    bl_idname='pigmi.pick_drag'
    bl_label='Pigmi Select / Drag'
    bl_options={'REGISTER'}

    @classmethod
    def poll(cls,context):
        from . import active_tool, supported, ACTIVE
        return bool(active_tool(context) and supported(context) and ACTIVE is None)

    def invoke(self,context,event):
        self.cursor=Cursor(context,event)
        self.target=self.cursor.pick()
        self.start=Vector((event.mouse_x,event.mouse_y))
        self.toggle=event.shift
        if self.toggle:
            select_hit(self.cursor,self.target,True)
            return {'FINISHED'}
        context.window_manager.modal_handler_add(self)
        return {'RUNNING_MODAL'}

    def modal(self,context,event):
        if context.mode!='EDIT_MESH' or not self.cursor.bm.is_valid:
            return {'CANCELLED'}
        if event.type in {'ESC','RIGHTMOUSE'}:
            if event.type=='ESC':
                from . import clear_selection
                clear_selection(context)
            return {'CANCELLED'}
        if event.type=='MOUSEMOVE':
            threshold=context.preferences.inputs.drag_threshold_mouse
            if (Vector((event.mouse_x,event.mouse_y))-self.start).length>=threshold:
                if self.target is None:
                    return {'CANCELLED'}
                if not self.target.select:
                    select_hit(self.cursor,self.target)
                # Only Blender's transform moves vertices; mouse-up confirms the drag.
                try:
                    bpy.ops.transform.translate('INVOKE_REGION_WIN',release_confirm=True)
                except RuntimeError as error:
                    self.report({'ERROR'},'Move: '+str(error))
                    return {'CANCELLED'}
                return {'FINISHED'}
        if event.type=='LEFTMOUSE' and event.value=='RELEASE':
            select_hit(self.cursor,self.target)
            return {'FINISHED'}
        return {'RUNNING_MODAL'}


class PIGMI_OT_extrude_selection(bpy.types.Operator):
    bl_idname='pigmi.extrude_selection'
    bl_label='Pigmi Extrude Selection'

    @classmethod
    def poll(cls,context):
        from . import active_tool, supported, ACTIVE
        return bool(active_tool(context) and supported(context) and ACTIVE is None)

    def invoke(self,context,event):
        bm=bmesh.from_edit_mesh(context.edit_object.data)
        faces=any(f.select and not f.hide for f in bm.faces)
        edges=any(e.select and not e.hide for e in bm.edges)
        verts=any(v.select and not v.hide for v in bm.verts)
        if not (faces or edges or verts):
            self.report({'WARNING'},'Select faces, edges or vertices before pressing E')
            return {'CANCELLED'}
        bmesh.update_edit_mesh(context.edit_object.data,loop_triangles=False,destructive=False)
        try:
            if faces:
                bpy.ops.mesh.extrude_region_move('INVOKE_REGION_WIN',
                    TRANSFORM_OT_translate={'orient_type':'NORMAL','constraint_axis':(False,False,True),'release_confirm':False})
            elif edges:
                bpy.ops.mesh.extrude_edges_move('INVOKE_REGION_WIN',
                    TRANSFORM_OT_translate={'constraint_axis':(False,False,False),'release_confirm':False})
            else:
                bpy.ops.mesh.extrude_vertices_move('INVOKE_REGION_WIN',
                    TRANSFORM_OT_translate={'constraint_axis':(False,False,False),'release_confirm':False})
        except RuntimeError as error:
            self.report({'ERROR'},'Extrude: '+str(error))
            return {'CANCELLED'}
        return {'FINISHED'}
