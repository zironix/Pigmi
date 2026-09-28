"""Stable construction frames derived from the geometry at the stroke start."""
import bmesh
from mathutils import Vector
from .geometry import plane_basis


def edge_direction(cursor, edge):
    return cursor.obj.matrix_world.to_3x3() @ (edge.verts[1].co-edge.verts[0].co)


def face_frame(cursor, face, preferred=None):
    normal=(cursor.obj.matrix_world.to_3x3().inverted().transposed() @ face.normal).normalized()
    edges=[e for e in face.edges if not e.hide]
    edge=preferred if preferred in edges else max(edges,key=lambda e:edge_direction(cursor,e).length_squared,default=None)
    tangent=edge_direction(cursor,edge) if edge is not None else None
    return normal,plane_basis(normal,tangent)[0]


def auto_frame(cursor, target=None):
    # The ray through the actual start point includes perspective/camera position.
    from bpy_extras import view3d_utils as view
    origin=cursor.start_point(target)
    origin=origin if origin is not None else cursor.plane_origin.copy()
    screen=view.location_3d_to_region_2d(cursor.region,cursor.rv3d,origin)
    toward_camera=-cursor.ray(screen)[1]
    view_right=cursor.rv3d.view_rotation @ Vector((1,0,0))
    candidates=[]

    def add(normal,tangent,label,bias=0):
        if normal.length<1e-7:
            return
        n=normal.normalized()
        u=plane_basis(n,tangent)[0]
        if n.dot(toward_camera)<0:
            n=-n
        if any(abs(n.dot(other[1]))>.9999 for other in candidates):
            return
        score=abs(n.dot(toward_camera))+bias
        candidates.append((score,n,u,label))

    def add_face(face,edge=None):
        n,u=face_frame(cursor,face,edge)
        add(n,u,'Auto: continue surface',.025)
        # A plane containing this edge and the face normal grows a side wall.
        add(u.cross(n),u,'Auto: perpendicular to surface')
        if edge is None:
            v=n.cross(u).normalized()
            add(u,v,'Auto: perpendicular across surface')

    if isinstance(target,bmesh.types.BMFace):
        add_face(target)
    elif isinstance(target,(bmesh.types.BMEdge,bmesh.types.BMVert)):
        faces=[f for f in target.link_faces if not f.hide]
        edges=[target] if isinstance(target,bmesh.types.BMEdge) else [e for e in target.link_edges if not e.hide]
        edges.sort(key=lambda e:edge_direction(cursor,e).length_squared,reverse=True)
        for face in faces:
            attached=target if isinstance(target,bmesh.types.BMEdge) else next((e for e in edges if e in face.edges),None)
            add_face(face,attached)
        if not faces and edges:
            u=edge_direction(cursor,edges[0]).normalized()
            if len(edges)>1:
                cross=max((u.cross(edge_direction(cursor,e).normalized()) for e in edges[1:]),key=lambda n:n.length_squared)
                if cross.length>.01:
                    add(cross,u,'Auto: connected edges',.025)
                    add(u.cross(cross),u,'Auto: perpendicular to edges')
            if not candidates:
                n=toward_camera-u*toward_camera.dot(u)
                if n.length<1e-5:
                    n=plane_basis(u)[0]
                add(n,u,'Auto: edge + camera')
    if not candidates:
        if cursor.settings.has_anchor:
            n=Vector(cursor.settings.last_normal)
            u=Vector(cursor.settings.last_tangent)
            add(n,u,'Auto: previous plane',.025)
            add(u.cross(n),u,'Auto: perpendicular to previous plane')
        else:
            add(toward_camera,view_right,'Auto: camera view')
    _,normal,tangent,label=max(candidates,key=lambda item:item[0])
    return origin,normal,tangent,label


def update_auto(cursor,target=None):
    if cursor.settings.locked:
        return
    cursor.plane_origin,cursor.plane_normal,cursor.plane_u,cursor.plane_label=auto_frame(cursor,target)
