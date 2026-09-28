bl_info = {'name': 'Pigmi Modeler', 'author': 'Pigmi', 'version': (0, 4, 1),
           'blender': (4, 2, 0), 'category': 'Mesh',
           'description': 'Native mesh editing with polygon preview and construction planes',
           'location': 'Edit Mode > Toolbar > Pigmi Modeler'}

import bpy
import bmesh
import blf
import gpu
from bpy.props import BoolProperty, FloatProperty, FloatVectorProperty, IntProperty, PointerProperty, EnumProperty, StringProperty
from bpy_extras import view3d_utils as view
from mathutils import Vector
from .cursor import Cursor, CYAN, GOLD, SHADERS
from .keyboard import event_key
from .planes import update_auto, face_frame
from .interaction import PIGMI_OT_pick_drag, PIGMI_OT_extrude_selection
from .geometry import plane_basis, create_face, polygon_error, project_plane

ACTIVE = None
HOVERS = {}
HANDLERS = []
KEYMAPS = []


def mixed_selection(context):
    if tuple(context.tool_settings.mesh_select_mode) != (True, True, True):
        context.tool_settings.mesh_select_mode = (True, True, True)

def active_tool(context):
    if context.mode != 'EDIT_MESH' or not context.area or context.area.type != 'VIEW_3D':
        return False
    tool = context.workspace.tools.from_space_view3d_mode('EDIT_MESH', create=False)
    return tool and tool.idname == 'pigmi.modeler'

def supported(context):
    return (context.mode == 'EDIT_MESH' and len(context.objects_in_mode) == 1
            and not context.edit_object.data.shape_keys
            and abs(context.edit_object.matrix_world.determinant()) > 1e-10)

class PigmiSettings(bpy.types.PropertyGroup):
    snap: BoolProperty(name='Snap to vertices', default=True)
    grid: BoolProperty(name='Grid', default=False)
    step: FloatProperty(name='Step', default=.25, min=.001, subtype='DISTANCE')
    radius: IntProperty(name='Pick radius', default=12, min=4, max=40)
    locked: BoolProperty(default=False)
    last_point: FloatVectorProperty(size=3)
    has_anchor: BoolProperty(default=False)
    origin: FloatVectorProperty(size=3)
    normal: FloatVectorProperty(size=3, default=(0,0,1))
    tangent: FloatVectorProperty(size=3, default=(1,0,0))
    last_normal: FloatVectorProperty(size=3, default=(0,0,1))
    last_tangent: FloatVectorProperty(size=3, default=(1,0,0))
    show_plane: BoolProperty(name='Show plane', default=True)
    plane_label: StringProperty(default='Auto: geometry at start')


class PIGMI_OT_blank(bpy.types.Operator):
    bl_idname = 'pigmi.blank'
    bl_label = 'New Pigmi Mesh'
    bl_options = {'REGISTER', 'UNDO'}

    @classmethod
    def poll(cls, context):
        return context.mode == 'OBJECT'

    def execute(self, context):
        mesh = bpy.data.meshes.new('Pigmi Mesh')
        obj = bpy.data.objects.new('Pigmi', mesh)
        context.collection.objects.link(obj)
        for other in context.selected_objects:
            other.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj
        obj.location = context.scene.cursor.location
        bpy.ops.object.mode_set(mode='EDIT')
        mixed_selection(context)
        bpy.ops.wm.tool_set_by_id(name='pigmi.modeler')
        return {'FINISHED'}

class PIGMI_OT_activate(bpy.types.Operator):
    bl_idname = 'pigmi.activate'
    bl_label = 'Use Pigmi Tool'

    @classmethod
    def poll(cls, context):
        return context.mode == 'EDIT_MESH'

    def execute(self, context):
        mixed_selection(context)
        context.space_data.show_gizmo = True
        bpy.ops.wm.tool_set_by_id(name='pigmi.modeler')
        return {'FINISHED'}

def change_plane(cursor, mode, selected=False):
    settings = cursor.settings
    if mode == 'PERP':
        origin=cursor.plane_origin.copy()
        tangent=cursor.plane_u.copy()
        normal=tangent.cross(cursor.plane_normal).normalized()
    elif mode == 'FACE':
        faces = [f for f in cursor.bm.faces if f.select and not f.hide]
        active = cursor.bm.faces.active
        chosen = active if active is not None and active in faces else faces[-1] if faces else None
        hit = (chosen, cursor.obj.matrix_world @ chosen.calc_center_median()) if selected and chosen is not None else cursor.face_hit()
        if not hit:
            return 'Hover a face and press P'
        face, point = hit
        hovered=cursor.pick() if not selected else None
        normal,tangent=face_frame(cursor,face,hovered if isinstance(hovered,bmesh.types.BMEdge) else None)
        origin = point
    elif mode == 'VIEW':
        origin = cursor.start_point(cursor.pick())
        if origin is None:
            origin = cursor.plane_origin.copy()
        normal = cursor.rv3d.view_rotation @ Vector((0,0,1))
        tangent = cursor.rv3d.view_rotation @ Vector((1,0,0))
    elif mode == 'FREE':
        settings.locked = False
        settings.plane_label = 'Auto: geometry at start'
        update_auto(cursor,cursor.pick())
        return None
    else:
        normal = cursor.plane_normal.copy()
        tangent = cursor.plane_u.copy()
        origin = cursor.plane_origin + normal * settings.step * (1 if mode == 'UP' else -1)
    settings.plane_label = 'Perpendicular plane' if mode == 'PERP' else 'Face plane' if mode == 'FACE' else 'View plane' if mode == 'VIEW' else 'Offset plane'
    settings.origin, settings.normal, settings.locked = origin, normal, True
    settings.tangent = tangent
    cursor.plane_origin, cursor.plane_normal, cursor.plane_u = origin.copy(), normal.copy(), tangent.copy()
    cursor.plane_label = settings.plane_label
    return None

class PIGMI_OT_plane(bpy.types.Operator):
    bl_idname = 'pigmi.plane'
    bl_label = 'Pigmi Construction Plane'
    bl_options = {'REGISTER', 'UNDO'}
    mode: EnumProperty(items=[(s,s,'') for s in ('FACE','VIEW','FREE','PERP','UP','DOWN')], default='FACE')
    selected: BoolProperty(default=False)

    @classmethod
    def poll(cls, context):
        return bool(active_tool(context) and supported(context) and ACTIVE is None)

    def invoke(self, context, event):
        if context.region.type != 'WINDOW':
            region = next((r for r in context.area.regions if r.type == 'WINDOW'), None)
            if region is None:
                return {'CANCELLED'}
            with context.temp_override(region=region):
                return self.execute(context)
        cursor = Cursor(context,event)
        update_auto(cursor,cursor.pick())
        return self.apply(context,cursor)

    def execute(self, context):
        return self.apply(context,Cursor(context))

    def apply(self, context, cursor):
        message = change_plane(cursor,self.mode,self.selected)
        if message:
            self.report({'WARNING'},message)
            return {'CANCELLED'}
        HOVERS[context.region.as_pointer()] = cursor
        context.area.tag_redraw()
        self.report({'INFO'},cursor.settings.plane_label)
        return {'FINISHED'}


class PIGMI_OT_draw(bpy.types.Operator):
    bl_idname = 'pigmi.draw'
    bl_label = 'Pigmi Draw Polygon'
    bl_options = {'REGISTER','UNDO','BLOCKING'}

    @classmethod
    def poll(cls,context):
        return bool(active_tool(context) and supported(context) and ACTIVE is None)

    wait_for_click: BoolProperty(default=False)

    def invoke(self,context,event):
        global ACTIVE
        if context.region.type != 'WINDOW':
            region=next((r for r in context.area.regions if r.type=='WINDOW'),None)
            if region is None:
                self.report({'ERROR'},'A 3D viewport window is required')
                return {'CANCELLED'}
            self.wait_for_click=True
            with context.temp_override(region=region):
                return self.start(context,event)
        return self.start(context,event)

    def start(self,context,event):
        global ACTIVE
        try:
            self.c=Cursor(context,None if self.wait_for_click else event)
            self.points,self.refs=[],[]
            self.preview=None
            self.note='DRAW: click corners; Enter finishes; Esc cancels.'
            if not self.wait_for_click:
                update_auto(self.c,self.c.pick())
                self.add_corner(context)
            self.c.action='DRAW'
            ACTIVE=self
            context.window_manager.modal_handler_add(self)
            HOVERS[context.region.as_pointer()]=self.c
            context.area.tag_redraw()
            self.report({'INFO'},'Pigmi drawing started: click corners, Esc to cancel')
            return {'RUNNING_MODAL'}
        except Exception as error:
            ACTIVE=None
            self.report({'ERROR'},'Draw could not start: '+str(error))
            return {'CANCELLED'}

    def finish(self,context,cancel=False):
        global ACTIVE
        ACTIVE=None
        HOVERS.clear()
        self.c.area.tag_redraw()
        return {'CANCELLED' if cancel else 'FINISHED'}

    def cancel(self,context):
        self.finish(context,True)

    def commit(self,context):
        c=self.c
        try:
            face=create_face(c.bm,self.points,self.refs,c.obj.matrix_world,c.plane_normal)
        except ValueError as error:
            self.note=str(error)
            return {'RUNNING_MODAL'}
        # Drawing selects only its result. Other editing is handled by Blender.
        for seq in (c.bm.faces,c.bm.edges,c.bm.verts):
            for element in seq:
                element.select=False
        c.bm.select_history.clear()
        face.select_set(True)
        c.bm.faces.active=face
        c.bm.select_history.add(face)
        bmesh.update_edit_mesh(c.obj.data,loop_triangles=True,destructive=True)
        c.settings.last_point=self.points[-1]
        c.settings.has_anchor=True
        c.settings.last_normal=c.plane_normal
        c.settings.last_tangent=c.plane_u
        return self.finish(context)

    def add_corner(self,context):
        c=self.c
        if not self.points:
            update_auto(c,c.pick())
        point=c.point_on_plane()
        if point is None:
            self.note='Plane is edge-on. Orbit or press V.'
            return {'RUNNING_MODAL'}
        if len(self.points)>=3:
            first=view.location_3d_to_region_2d(c.region,c.rv3d,self.points[0])
            if first is not None and (first-c.mouse).length<c.settings.radius:
                return self.commit(context)
        if self.points and (point-self.points[-1]).length<1e-6:
            return {'RUNNING_MODAL'}
        if not self.points:
            c.plane_origin=point.copy()
        self.points.append(point.copy())
        self.refs.append(c.snap_ref)
        if len(self.points)==4:
            result=self.commit(context)
            if 'RUNNING_MODAL' in result:
                self.points.pop(); self.refs.pop()
            return result
        return {'RUNNING_MODAL'}

    def modal(self,context,event):
        try:
            return self.handle(context,event)
        except Exception as error:
            self.report({'ERROR'},'Pigmi: '+str(error))
            return self.finish(context,True)

    def handle(self,context,event):
        c=self.c
        if context.mode!='EDIT_MESH' or context.edit_object!=c.obj or not c.bm.is_valid:
            return self.finish(context,True)
        c.area.tag_redraw()
        if event.type in {'ESC','RIGHTMOUSE'} and event.value=='PRESS':
            if event.type=='ESC':
                clear_selection(context)
            return self.finish(context,True)
        if event.type in {'MIDDLEMOUSE','WHEELUPMOUSE','WHEELDOWNMOUSE','TRACKPADPAN','TRACKPADZOOM'}:
            return {'PASS_THROUGH'}
        c.mouse=Vector((event.mouse_x-c.region.x,event.mouse_y-c.region.y))
        key=event_key(event)
        if event.value=='PRESS' or event.type=='TEXTINPUT':
            if key in {'G','E','TAB'} or (event.ctrl and event.type=='Z'):
                # End only the uncommitted drawing, then let Blender handle the key.
                self.finish(context,True)
                if key=='E':
                    bpy.ops.pigmi.extrude_selection('INVOKE_REGION_WIN')
                    return {'CANCELLED'}
                if key=='G':
                    bpy.ops.transform.translate('INVOKE_REGION_WIN')
                    return {'CANCELLED'}
                return {'CANCELLED','PASS_THROUGH'}
            if key in {'P','V','UP_ARROW','DOWN_ARROW'}:
                mode=('PERP' if event.shift else 'FACE') if key=='P' else ('FREE' if event.shift else 'VIEW') if key=='V' else 'UP' if key=='UP_ARROW' else 'DOWN'
                message=change_plane(c,mode)
                self.note=message or c.settings.plane_label
                if not message:
                    self.points=[p if ref is not None else project_plane(p,c.plane_origin,c.plane_normal) for p,ref in zip(self.points,self.refs)]
            elif event.type=='LEFTMOUSE':
                return self.add_corner(context)
            elif event.type in {'RET','NUMPAD_ENTER','SPACE'}:
                return self.commit(context)
            elif event.type=='BACK_SPACE' and self.points:
                self.points.pop(); self.refs.pop()
        self.preview=c.point_on_plane()
        return {'RUNNING_MODAL'}


class PIGMI_GT_hover(bpy.types.Gizmo):
    bl_idname = 'PIGMI_GT_hover'

    def setup(self):
        self.use_draw_modal = True

    def draw(self, context):
        pass

    def test_select(self, context, location):
        if ACTIVE or not supported(context):
            return -1
        cursor = Cursor(context)
        cursor.mouse = Vector(location)
        cursor.hover = cursor.pick()
        update_auto(cursor,cursor.hover)
        HOVERS[context.region.as_pointer()] = cursor
        context.area.tag_redraw()
        return -1

class PIGMI_GGT_hover(bpy.types.GizmoGroup):
    bl_idname = 'PIGMI_GGT_hover'
    bl_label = 'Pigmi Hover'
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'WINDOW'
    bl_options = {'3D'}

    @classmethod
    def poll(cls, context):
        return active_tool(context) and supported(context)

    def setup(self, context):
        mixed_selection(context)
        self.gizmos.new('PIGMI_GT_hover')

def overlay_cursor():
    context=bpy.context
    if not active_tool(context) or not context.region or context.region.type!='WINDOW' or not supported(context):
        return None
    if ACTIVE:
        c=ACTIVE.c
        return c if context.region==c.region else None
    c=HOVERS.get(context.region.as_pointer())
    if c is None or c.obj!=context.edit_object or not c.bm.is_valid:
        return None
    if c.settings.locked:
        c.plane_origin=Vector(c.settings.origin)
        c.plane_normal=Vector(c.settings.normal)
        c.plane_u=plane_basis(c.plane_normal,Vector(c.settings.tangent))[0]
        c.plane_label=c.settings.plane_label
    else:
        update_auto(c,c.hover if c.hover is not None and c.hover.is_valid else None)
    return c

def marker(c, point, color):
    xy=view.location_3d_to_region_2d(c.region,c.rv3d,point)
    if xy is None:
        return
    scale=(view.region_2d_to_location_3d(c.region,c.rv3d,xy+Vector((5,0)),point)-point).length
    u=c.rv3d.view_rotation @ Vector((scale,0,0))
    v=c.rv3d.view_rotation @ Vector((0,scale,0))
    c.lines([point-u-v,point+u-v,point+u-v,point+u+v,point+u+v,point-u+v,point-u+v,point-u-v],color,2)

def clear_selection(context):
    bm=bmesh.from_edit_mesh(context.edit_object.data)
    for seq in (bm.faces,bm.edges,bm.verts):
        for element in seq:
            element.select=False
    bm.select_history.clear()
    bm.faces.active=None
    bmesh.update_edit_mesh(context.edit_object.data,loop_triangles=False,destructive=False)
    context.area.tag_redraw()


class PIGMI_OT_deselect(bpy.types.Operator):
    bl_idname='pigmi.deselect'
    bl_label='Pigmi Deselect All'
    bl_options={'UNDO'}

    @classmethod
    def poll(cls,context):
        return bool(active_tool(context) and supported(context) and ACTIVE is None)

    def execute(self,context):
        clear_selection(context)
        return {'FINISHED'}


class PIGMI_OT_text_shortcut(bpy.types.Operator):
    bl_idname='pigmi.text_shortcut'
    bl_label='Pigmi Layout Independent Shortcut'

    @classmethod
    def poll(cls,context):
        return bool(active_tool(context) and supported(context) and ACTIVE is None
                    and context.region and context.region.type=='WINDOW')

    def invoke(self,context,event):
        if event.ctrl or event.alt or event.oskey:
            return {'PASS_THROUGH'}
        key=event_key(event)
        if event.shift and key not in {'V','P'}:
            return {'PASS_THROUGH'}
        if key=='F':
            bpy.ops.pigmi.draw('INVOKE_REGION_WIN')
        elif key=='E':
            bpy.ops.pigmi.extrude_selection('INVOKE_REGION_WIN')
        elif key=='P':
            bpy.ops.pigmi.plane('INVOKE_REGION_WIN',mode='PERP' if event.shift else 'FACE')
        elif key=='V':
            bpy.ops.pigmi.plane('INVOKE_REGION_WIN',mode='FREE' if event.shift else 'VIEW')
        elif key=='G':
            bpy.ops.transform.translate('INVOKE_REGION_WIN')
        else:
            return {'PASS_THROUGH'}
        return {'FINISHED'}


class PIGMI_WST_modeler(bpy.types.WorkSpaceTool):
    bl_idname='pigmi.modeler'
    bl_label='Pigmi Modeler'
    bl_description='Click and Shift-click: select. Drag/G: move. E: extrude selection. F: draw. P: face plane'
    bl_space_type='VIEW_3D'
    bl_context_mode='EDIT_MESH'
    bl_icon='ops.mesh.polybuild_hover'
    bl_widget='PIGMI_GGT_hover'
    # Selection uses exactly the same picker as the cyan hover; translation is native.
    bl_keymap=(
        ('pigmi.text_shortcut',{'type':'TEXTINPUT','value':'ANY','any':True},{}),
        ('pigmi.deselect',{'type':'ESC','value':'PRESS'},{}),
        ('pigmi.pick_drag',{'type':'LEFTMOUSE','value':'PRESS'},{}),
        ('pigmi.pick_drag',{'type':'LEFTMOUSE','value':'PRESS','shift':True},{}),
        ('transform.translate',{'type':'G','value':'PRESS'},{}),
        ('pigmi.extrude_selection',{'type':'E','value':'PRESS'},{}),
        ('pigmi.draw',{'type':'F','value':'PRESS'},{}),
        ('pigmi.plane',{'type':'P','value':'PRESS'},{'properties':[('mode','FACE')]}),
        ('pigmi.plane',{'type':'P','value':'PRESS','shift':True},{'properties':[('mode','PERP')]}),
        ('pigmi.plane',{'type':'V','value':'PRESS'},{'properties':[('mode','VIEW')]}),
        ('pigmi.plane',{'type':'V','value':'PRESS','shift':True},{'properties':[('mode','FREE')]}),
        ('pigmi.plane',{'type':'UP_ARROW','value':'PRESS'},{'properties':[('mode','UP')]}),
        ('pigmi.plane',{'type':'DOWN_ARROW','value':'PRESS'},{'properties':[('mode','DOWN')]}),
    )

    @staticmethod
    def draw_settings(context,layout,tool):
        s=context.scene.pigmi_settings
        layout.prop(s,'snap',text='Draw snap')
        layout.prop(s,'grid',text='Draw grid')
        layout.prop(s,'step')
        layout.label(text=s.plane_label)


class PIGMI_PT_panel(bpy.types.Panel):
    bl_label='Pigmi Modeler 0.4.1'
    bl_idname='PIGMI_PT_panel'
    bl_space_type='VIEW_3D'
    bl_region_type='UI'
    bl_category='Pigmi'

    def draw(self,context):
        layout=self.layout
        layout.operator('pigmi.blank',icon='MESH_DATA')
        layout.operator('pigmi.activate',icon='EDITMODE_HLT')
        s=context.scene.pigmi_settings
        layout.label(text=s.plane_label)
        op=layout.operator('pigmi.draw',text='Draw Polygon (F)')
        op.wait_for_click=True
        layout.operator_context='INVOKE_REGION_WIN'
        layout.operator('pigmi.extrude_selection',text='Extrude Selection (E)')
        layout.operator_context='INVOKE_DEFAULT'
        op=layout.operator('pigmi.plane',text='Plane from Selected Face')
        op.mode='FACE'; op.selected=True
        layout.prop(s,'show_plane')
        layout.prop(s,'snap',text='Snap while drawing')
        layout.prop(s,'grid',text='Grid while drawing')
        layout.prop(s,'step')
        layout.separator()
        for text in ('Click / Shift-click: select','Drag or G: Blender move','E: extrude faces / edges / vertices','F / А: draw | Esc: cancel + deselect','P / З: face plane | Shift P: 90 degrees','V: view plane | Shift V: auto','Move/extrude snapping: Blender magnet'):
            layout.label(text=text)


def draw_world():
    c=overlay_cursor()
    if c is None:
        return
    c.shaders()
    gpu.state.blend_set('ALPHA')
    gpu.state.depth_mask_set(False)
    try:
        gpu.state.depth_test_set('LESS_EQUAL')
        if c.settings.show_plane:
            u,v=plane_basis(c.plane_normal,c.plane_u)
            step=c.settings.step
            lines=[]
            for i in range(-5,6):
                for a,b in ((u,v),(v,u)):
                    lines += [c.plane_origin+a*i*step-b*5*step,c.plane_origin+a*i*step+b*5*step]
            c.lines(lines,(.12,.65,.8,.3),1)
            c.lines([c.plane_origin,c.plane_origin+u*step*3],(1,.35,.2,.9),2)
            c.lines([c.plane_origin,c.plane_origin+v*step*3],(.3,1,.4,.9),2)
        gpu.state.depth_test_set('NONE')
        if ACTIVE:
            op=ACTIVE
            pts=list(op.points)
            if op.preview is not None and (not pts or (op.preview-pts[-1]).length>1e-6):
                first=view.location_3d_to_region_2d(c.region,c.rv3d,pts[0]) if pts else None
                closing=len(pts)>=3 and first is not None and (first-c.mouse).length<c.settings.radius
                if not closing:
                    pts.append(op.preview)
            error=polygon_error(pts,c.plane_normal) if len(pts)>=3 else None
            c.polygon(pts,(1,.25,.2,1) if error else CYAN,not error)
            for point in op.points:
                marker(c,point,CYAN)
        elif c.hover is not None and c.hover.is_valid:
            pts=c.element_points(c.hover)
            if len(pts)==1:
                marker(c,pts[0],CYAN)
            else:
                c.polygon(pts,CYAN)
        if c.snap_ref is not None and c.snap_ref.is_valid:
            marker(c,c.obj.matrix_world @ c.snap_ref.co,(.4,1,.3,1))
    finally:
        gpu.state.depth_mask_set(True)
        gpu.state.depth_test_set('NONE')
        gpu.state.blend_set('NONE')


def draw_hud():
    c=overlay_cursor()
    if c is None:
        return
    kind = 'VERTEX' if isinstance(c.hover,bmesh.types.BMVert) else 'EDGE' if isinstance(c.hover,bmesh.types.BMEdge) else 'FACE' if c.hover is not None else 'EMPTY'
    rows=['PIGMI 0.4.1  |  '+kind+'  |  '+c.plane_label,
          ACTIVE.note if ACTIVE else 'Click / Shift: select   Drag: move   E: extrude selection   F: draw   P: face plane']
    for i,row in enumerate(rows):
        blf.size(0,14 if i==0 else 12)
        blf.position(0,65,65-i*22,0)
        blf.color(0,*(CYAN if i==0 else (.92,.95,1,1)))
        blf.draw(0,row)


CLASSES=(PigmiSettings,PIGMI_OT_blank,PIGMI_OT_activate,PIGMI_OT_plane,PIGMI_OT_draw,PIGMI_OT_pick_drag,PIGMI_OT_extrude_selection,PIGMI_OT_deselect,PIGMI_OT_text_shortcut,PIGMI_GT_hover,PIGMI_GGT_hover,PIGMI_PT_panel)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.pigmi_settings=PointerProperty(type=PigmiSettings)
    bpy.utils.register_tool(PIGMI_WST_modeler,after={'builtin.poly_build'},separator=True,group=False)
    # Mesh mode's P (Separate) / F (Fill) can win over a tool keymap.
    # poll limits these higher-priority bindings to this active tool only.
    config=bpy.context.window_manager.keyconfigs.addon
    if config:
        km=config.keymaps.new(name='Mesh',space_type='EMPTY')
        for key,operator,mode,shift in (('ESC','pigmi.deselect',None,False),('E','pigmi.extrude_selection',None,False),('P','pigmi.plane','FACE',False),('P','pigmi.plane','PERP',True),('F','pigmi.draw',None,False),('V','pigmi.plane','VIEW',False),('V','pigmi.plane','FREE',True),('UP_ARROW','pigmi.plane','UP',False),('DOWN_ARROW','pigmi.plane','DOWN',False)):
            item=km.keymap_items.new(operator,key,'PRESS',shift=shift,head=True)
            if mode:
                item.properties.mode=mode
            KEYMAPS.append((km,item))
        item=km.keymap_items.new('pigmi.text_shortcut','TEXTINPUT','ANY',any=True,head=True)
        KEYMAPS.append((km,item))
    if not bpy.app.background:
        HANDLERS.extend((bpy.types.SpaceView3D.draw_handler_add(draw_world,(),'WINDOW','POST_VIEW'),bpy.types.SpaceView3D.draw_handler_add(draw_hud,(),'WINDOW','POST_PIXEL')))


def unregister():
    if ACTIVE:
        ACTIVE.cancel(bpy.context)
    for km,item in KEYMAPS:
        km.keymap_items.remove(item)
    KEYMAPS.clear()
    for handle in HANDLERS:
        bpy.types.SpaceView3D.draw_handler_remove(handle,'WINDOW')
    HANDLERS.clear(); HOVERS.clear(); SHADERS.clear()
    bpy.utils.unregister_tool(PIGMI_WST_modeler)
    del bpy.types.Scene.pigmi_settings
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
