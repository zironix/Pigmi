"""One short background check; no test framework."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import bpy,bmesh
from mathutils import Matrix,Vector
import pigmi_modeler as pm
from pigmi_modeler.geometry import create_face,extrude,polygon_error,match_edge_endpoints
pm.register()
assert hasattr(bpy.context.scene,'pigmi_settings')
bm=bmesh.new()
points=[Vector(p) for p in ((0,0,0),(1,0,0),(1,1,0),(0,1,0))]
f=create_face(bm,points,[None]*4,Matrix.Identity(4),Vector((0,0,1)))
extrude(bm,f,Vector((0,0,1)))
assert len(bm.faces)==6 and all(e.is_manifold for e in bm.edges)
assert polygon_error([points[i] for i in (0,2,1,3)],Vector((0,0,1)))
a,b=Vector((0,0)),Vector((1,0))
assert match_edge_endpoints([a,b],[b,a],[1,2])==(2,1)
bm.free()
pm.unregister()
print('PIGMI OK: tool registration, manifold extrusion, polygon validation, edge pairing')
