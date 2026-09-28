"""Original Pigmi cursor picking and GPU drawing; no PolyQuilt code."""
import bpy
import bmesh
import gpu
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_line_line
from bpy_extras import view3d_utils as view
from gpu_extras.batch import batch_for_shader
from .geometry import ray_plane, grid_snap, triangles, plane_basis

CYAN = (.13, .8, 1, 1)
GOLD = (1, .68, .18, 1)
SHADERS = {}

class Cursor:
    def __init__(self, context, event=None):
        self.obj = context.edit_object
        self.area, self.region, self.rv3d = context.area, context.region, context.region_data
        self.settings = context.scene.pigmi_settings
        self.bm = bmesh.from_edit_mesh(self.obj.data)
        self.mouse = Vector((event.mouse_region_x, event.mouse_region_y)) if event else Vector((0,0))
        self.action = None
        self.moving = []
        self.hover = self.snap_ref = None
        self.plane_origin = Vector(self.settings.origin) if self.settings.locked else (Vector(self.settings.last_point) if self.settings.has_anchor else context.scene.cursor.location.copy())
        self.plane_normal = Vector(self.settings.normal) if self.settings.locked else self.rv3d.view_rotation @ Vector((0,0,1))
        self.plane_u = plane_basis(self.plane_normal,Vector(self.settings.tangent))[0] if self.settings.locked else self.rv3d.view_rotation @ Vector((1,0,0))
        self.plane_label = self.settings.plane_label
        self.rebuild()

    def shaders(self):
        if not SHADERS:
            SHADERS['line'] = gpu.shader.from_builtin('POLYLINE_UNIFORM_COLOR')
            SHADERS['fill'] = gpu.shader.from_builtin('UNIFORM_COLOR')
        self.line_shader, self.fill_shader = SHADERS['line'], SHADERS['fill']

    def rebuild(self):
        for seq in (self.bm.verts, self.bm.edges, self.bm.faces):
            seq.ensure_lookup_table()
            seq.index_update()
        self.bm.normal_update()
        self.bvh = BVHTree.FromBMesh(self.bm) if self.bm.faces else None
        self.hover = None

    def ray(self, xy=None):
        xy = self.mouse if xy is None else xy
        return (view.region_2d_to_origin_3d(self.region, self.rv3d, xy),
                view.region_2d_to_vector_3d(self.region, self.rv3d, xy))

    def face_hit(self):
        if not self.bvh:
            return None
        origin, direction = self.ray()
        inv = self.obj.matrix_world.inverted()
        co, normal, index, distance = self.bvh.ray_cast(inv @ origin, (inv.to_3x3() @ direction).normalized())
        if index is not None:
            face = self.bm.faces[index]
            if not face.hide:
                return face, self.obj.matrix_world @ co
        return None

    def visible(self, point):
        if not self.bvh:
            return True
        xy = view.location_3d_to_region_2d(self.region, self.rv3d, point)
        if xy is None:
            return False
        origin, direction = self.ray(xy)
        inv = self.obj.matrix_world.inverted()
        target, local_origin = inv @ point, inv @ origin
        delta = target - local_origin
        if delta.length < 1e-7:
            return True
        hit, _, _, distance = self.bvh.ray_cast(local_origin, delta.normalized(), delta.length)
        return hit is None or (hit - target).length <= max(1e-4, delta.length * 1e-5)

    def pick(self):
        matrix = self.obj.matrix_world
        projected = {}
        candidates = []
        for vertex in self.bm.verts:
            if vertex.hide:
                continue
            point = matrix @ vertex.co
            xy = view.location_3d_to_region_2d(self.region, self.rv3d, point)
            projected[vertex] = xy
            if xy is not None and (xy - self.mouse).length <= self.settings.radius:
                candidates.append(((xy - self.mouse).length, vertex, point))
        for _, vertex, point in sorted(candidates, key=lambda x: x[0]):
            if self.visible(point):
                return vertex
        candidates = []
        for edge in self.bm.edges:
            if edge.hide:
                continue
            a, b = [projected.get(v) for v in edge.verts]
            if a is None or b is None:
                continue
            delta = b - a
            t = max(0, min(1, (self.mouse - a).dot(delta) / max(delta.length_squared, 1e-10)))
            distance = (self.mouse - a - t * delta).length
            if distance <= self.settings.radius * .8:
                point = matrix @ edge.verts[0].co.lerp(edge.verts[1].co, t)
                candidates.append((distance, edge, point))
        for _, edge, point in sorted(candidates, key=lambda x: x[0]):
            if self.visible(point):
                return edge
        hit = self.face_hit()
        return hit[0] if hit else None

    def vertex_snap(self, screen=None, exclude=()):
        screen = self.mouse if screen is None else screen
        best, result = self.settings.radius, None
        for vertex in self.bm.verts:
            if vertex.hide or vertex in exclude:
                continue
            target = self.obj.matrix_world @ vertex.co
            xy = view.location_3d_to_region_2d(self.region, self.rv3d, target)
            if xy is not None and (xy-screen).length < best and self.visible(target):
                best, result = (xy-screen).length, vertex
        return result

    def start_point(self, element=None):
        if isinstance(element, bmesh.types.BMVert):
            return self.obj.matrix_world @ element.co
        if isinstance(element, bmesh.types.BMEdge):
            a, b = [self.obj.matrix_world @ v.co for v in element.verts]
            origin, direction = self.ray()
            closest = intersect_line_line(a, b, origin, origin+direction)
            if closest is not None:
                t = max(0, min(1, (closest[0]-a).dot(b-a)/max((b-a).length_squared,1e-20)))
                return a.lerp(b,t)
        hit = self.face_hit()
        if hit:
            return hit[1]
        return ray_plane(*self.ray(), self.plane_origin, self.plane_normal)

    def point_on_plane(self, origin=None, normal=None, snap=True):
        origin = self.plane_origin if origin is None else origin
        normal = self.plane_normal if normal is None else normal
        self.snap_ref = self.vertex_snap(exclude=self.moving) if snap and self.settings.snap else None
        # A real vertex takes priority over the free-space construction plane.
        if self.snap_ref is not None:
            return self.obj.matrix_world @ self.snap_ref.co
        point = ray_plane(*self.ray(), origin, normal)
        if point is not None and snap and self.settings.grid:
            point = grid_snap(point, origin, normal, self.settings.step, self.plane_u)
        return point

    def element_points(self, element):
        verts = [element] if isinstance(element, bmesh.types.BMVert) else element.verts
        return [self.obj.matrix_world @ v.co for v in verts]

    def select_vertices(self, vertices):
        chosen = set(vertices)
        self.bm.select_history.clear()
        for vertex in self.bm.verts:
            vertex.select = vertex in chosen and not vertex.hide
        for edge in self.bm.edges:
            edge.select = not edge.hide and all(v.select for v in edge.verts)
        for face in self.bm.faces:
            face.select = not face.hide and all(v.select for v in face.verts)
        bmesh.update_edit_mesh(self.obj.data, loop_triangles=False, destructive=False)

    def select(self, element, extend=False):
        vertices = {element} if isinstance(element,bmesh.types.BMVert) else set(element.verts)
        chosen = {v for v in self.bm.verts if v.select} if extend else set()
        if extend and vertices.issubset(chosen):
            chosen.difference_update(vertices)
        else:
            chosen.update(vertices)
        self.select_vertices(chosen)
        if element.select:
            self.bm.select_history.add(element)

    def lines(self, points, color=CYAN, width=2):
        if not points:
            return
        shader = self.line_shader
        shader.bind()
        shader.uniform_float('viewportSize', gpu.state.viewport_get()[2:])
        shader.uniform_float('lineWidth', width)
        shader.uniform_float('color', color)
        batch_for_shader(shader, 'LINES', {'pos': points}).draw(shader)

    def polygon(self, points, color=CYAN, close=True):
        if len(points) >= 3 and close:
            self.fill_shader.bind()
            self.fill_shader.uniform_float('color', (*color[:3], .18))
            batch_for_shader(self.fill_shader, 'TRIS', {'pos': triangles(points)}).draw(self.fill_shader)
        edges = [p for a, b in zip(points, points[1:]) for p in (a, b)]
        if close and len(points) > 2:
            edges.extend((points[-1], points[0]))
        self.lines(edges, color)
