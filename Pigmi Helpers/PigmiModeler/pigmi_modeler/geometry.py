"""Geometry operations shared by the modal tool and background tests."""
import bmesh
from mathutils import Vector
from mathutils.geometry import intersect_line_plane, tessellate_polygon


EPS = 1e-6


def plane_basis(normal, tangent=None):
    n = normal.normalized()
    if tangent is not None:
        u = tangent - n * tangent.dot(n)
        if u.length > 1e-8:
            u.normalize()
            return u, n.cross(u).normalized()
    seed = Vector((0, 0, 1)) if abs(n.z) < .9 else Vector((0, 1, 0))
    u = seed.cross(n).normalized()
    return u, n.cross(u).normalized()


def project_plane(point, origin, normal):
    return point - normal * (point - origin).dot(normal)


def ray_plane(origin, direction, plane_origin, normal):
    if abs(direction.dot(normal)) < EPS:
        return None
    return intersect_line_plane(origin, origin + direction, plane_origin, normal, False)


def grid_snap(point, origin, normal, step, tangent=None):
    u, v = plane_basis(normal, tangent)
    d = point - origin
    return origin + u * (round(d.dot(u) / step) * step) + v * (round(d.dot(v) / step) * step)


def polygon_error(points, normal):
    """Validate topology in a polygon-derived projection; warped quads are valid."""
    if len(points) < 3:
        return "At least three corners are needed"
    scale = max((p - points[0]).length for p in points)
    eps = max(1e-8, EPS * scale)
    offsets = [p - points[0] for p in points]
    area_normal = sum((a.cross(b) for a, b in zip(offsets, offsets[1:] + offsets[:1])), Vector())
    strongest = max((a.cross(b) for i, a in enumerate(offsets) for b in offsets[i+1:]), key=lambda n: n.length_squared)
    if strongest.length <= eps * eps:
        return "Polygon has no area"
    projection_normal = area_normal if area_normal.length > strongest.length * .01 else strongest
    u, v = plane_basis(projection_normal)
    if any((a - b).length < eps for i, a in enumerate(points) for b in points[i + 1:]):
        return "Two corners occupy the same position"
    xy = [Vector(((p - points[0]).dot(u), (p - points[0]).dot(v))) for p in points]
    def cross(a, b, c):
        ab, ac = b - a, c - a
        return ab.x * ac.y - ab.y * ac.x
    area = sum(a.x * b.y - b.x * a.y for a, b in zip(xy, xy[1:] + xy[:1]))
    if abs(area) < eps * eps:
        return "Polygon has no area"
    def on_segment(a, b, p):
        return abs(cross(a, b, p)) <= eps * eps and all(min(a[k], b[k]) - eps <= p[k] <= max(a[k], b[k]) + eps for k in (0, 1))
    n = len(xy)
    for i in range(n):
        a, b = xy[i], xy[(i + 1) % n]
        for j in range(i + 1, n):
            if j == i + 1 or (i == 0 and j == n - 1):
                continue
            c, d = xy[j], xy[(j + 1) % n]
            crosses = cross(a, b, c) * cross(a, b, d) < 0 and cross(c, d, a) * cross(c, d, b) < 0
            if crosses or any((on_segment(a, b, c), on_segment(a, b, d), on_segment(c, d, a), on_segment(c, d, b))):
                return "Polygon edges intersect"
    return None


def create_face(bm, points, refs, world_matrix, normal):
    error = polygon_error(points, normal)
    if error:
        raise ValueError(error)
    inverse = world_matrix.inverted()
    existing = [v for v in refs if v is not None]
    if len(existing) == len(points) and bm.faces.get(existing) is not None:
        raise ValueError("This face already exists")
    made = []
    try:
        verts = []
        for p, ref in zip(points, refs):
            if ref is not None and ref.is_valid:
                verts.append(ref)
            else:
                vertex = bm.verts.new(inverse @ p)
                made.append(vertex)
                verts.append(vertex)
        face = bm.faces.new(verts)
        face.normal_update()
        world_normal = world_matrix.to_3x3().inverted().transposed() @ face.normal
        if world_normal.dot(normal) < 0:
            face.normal_flip()
        # Match existing boundary winding if there is an adjacent face.
        for loop in face.loops:
            edge = loop.edge
            neighbors = [l for l in edge.link_loops if l.face != face]
            if len(neighbors) == 1:
                if neighbors[0].vert == loop.vert:
                    face.normal_flip()
                break
        face.select_set(True)
        bm.normal_update()
        return face
    except Exception:
        for vertex in made:
            if vertex.is_valid:
                bm.verts.remove(vertex)
        raise


def extrude(bm, element, delta):
    if delta.length < EPS:
        raise ValueError("Extrusion distance is zero")
    if isinstance(element, bmesh.types.BMFace):
        result = bmesh.ops.extrude_face_region(bm, geom=[element], use_keep_orig=False)
    elif isinstance(element, bmesh.types.BMEdge):
        if len(element.link_faces) > 1:
            raise ValueError("Choose a boundary or loose edge")
        result = bmesh.ops.extrude_edge_only(bm, edges=[element])
    else:
        raise ValueError("Hover a face or boundary edge")
    verts = [v for v in result["geom"] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=verts, vec=delta)
    bm.normal_update()
    return verts


def triangles(points):
    return [p for tri in tessellate_polygon([points]) for p in tri] if len(points) >= 3 else []


def match_edge_endpoints(screen_new, screen_existing, vertices):
    """Adapted from PolyQuilt SubToolEdgeExtrude.AdsorptionEdge (GPL-3.0+).

    Sakana3 / PolyQuilt contributors; see THIRD_PARTY.md.
    Pair ends by screen distance so a bridge does not twist.
    """
    st0, st1 = screen_new
    se0, se1 = screen_existing
    if (st0-se0).length + (st1-se1).length > (st0-se1).length + (st1-se0).length:
        return vertices[1], vertices[0]
    return vertices[0], vertices[1]
