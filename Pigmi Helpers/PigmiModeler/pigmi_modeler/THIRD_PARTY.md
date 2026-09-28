Pigmi Modeler is an independent add-on, not an official PolyQuilt release.

`geometry.match_edge_endpoints` adapts the endpoint matching from
`SubToolEdgeExtrude.AdsorptionEdge` in PolyQuilt by Sakana3 and contributors,
via Dan-Gry's maintained fork, under GPL-3.0-or-later.

Source: https://github.com/Dangry98/PolyQuilt-for-Blender-4.0
Revision: e9e4870d04f0eada1f9f76df148daf9b5e0e64b4
Path: Addons/PolyQuilt_Fork/subtools/subtool_edge_extrude.py
Original project: https://github.com/sakana3/PolyQuilt

The function was adapted to accept projected coordinates and vertex references
without depending on PolyQuilt's QMesh and utility modules. The remaining Pigmi
implementation is maintained independently. Click/drag/hold interaction design
was informed by reading PolyQuilt's master tool, low-poly tool and polygon tool.
See LICENSE for the GNU General Public License version 3; later versions may be used.
