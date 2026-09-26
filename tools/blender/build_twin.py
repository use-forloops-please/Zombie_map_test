"""
Authors a Blender twin of a JSON map and exports it as level.glb, following the
conventions in docs/MAPPING.md: every brush becomes a mesh (collide / nav custom
properties), every entity becomes a named empty with custom properties.

Run headless from the repo root:

    blender -b --factory-startup -P tools/blender/build_twin.py -- \
        public/maps/bunker-01/map.json public/maps/bunker-01-art/level.glb [out.blend]

Pass a third path to also save the .blend, to open and edit it by hand.

Coordinates: the game is Y-up with yaw 0 facing -Z; Blender is Z-up. A game point
(x, y, z) is Blender (x, -z, y), and a game yaw is a rotation about Blender's Z axis.
The glTF exporter converts back (+Y up), so what you place in Blender is where it plays.
"""

import json
import math
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1 :]
if len(args) < 2:
    raise SystemExit("usage: build_twin.py <map.json> <out.glb> [out.blend]")
map_path, glb_path = args[0], args[1]
blend_path = args[2] if len(args) > 2 else None

with open(map_path, encoding="utf-8") as f:
    source = json.load(f)

MATERIAL_COLORS = {
    "concrete": "#8a8d92",
    "plaster": "#a39c8e",
    "wood": "#8c6a45",
    "metal": "#6c7680",
    "dirt": "#5e5242",
}


def to_blender(p):
    """Game (x, y, z) -> Blender (x, -z, y)."""
    return (p[0], -p[2], p[1])


def size_to_blender(s):
    return (s[0], s[2], s[1])


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    hex_color = MATERIAL_COLORS[name]
    rgb = [srgb_to_linear(int(hex_color[i : i + 2], 16) / 255) for i in (1, 3, 5)]
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = 0.55 if name == "metal" else 0.92
    bsdf.inputs["Metallic"].default_value = 0.3 if name == "metal" else 0.0
    return mat


def empty(name, pos, display="PLAIN_AXES", yaw=0.0, half=None, props=None):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = display
    obj.empty_display_size = 1
    obj.location = to_blender(pos)
    obj.rotation_euler = (0, 0, math.radians(yaw))
    if half is not None:
        obj.scale = size_to_blender(half)
    for key, value in (props or {}).items():
        obj[key] = value
    bpy.context.scene.collection.objects.link(obj)
    return obj


# Start from an empty scene.
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

# Brushes -> cube meshes. Walkable brushes are ground (nav); everything is solid (collide).
for i, brush in enumerate(source.get("brushes", [])):
    size = brush["size"]
    bpy.ops.mesh.primitive_cube_add(size=1, location=to_blender(brush["pos"]))
    obj = bpy.context.active_object
    obj.name = f"brush_{i:03d}_{brush.get('material', 'concrete')}"
    obj.scale = size_to_blender(size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material(brush.get("material", "concrete")))
    obj["collide"] = True
    if brush.get("walkable", False):
        obj["nav"] = True

for s in source.get("playerSpawns", []):
    empty(f"spawn_{len([o for o in bpy.data.objects if o.name.startswith('spawn_')])}",
          s["pos"], "ARROWS", s.get("yaw", 0))

for z in source.get("zones", []):
    lo, hi = z["bounds"]["min"], z["bounds"]["max"]
    centre = [(a + b) / 2 for a, b in zip(lo, hi)]
    half = [(b - a) / 2 for a, b in zip(lo, hi)]
    empty(f"zone_{z['id']}", centre, "CUBE", half=half,
          props={"activeAtStart": bool(z.get("activeAtStart", False))})

for w in source.get("windows", []):
    props = {"zone": w["zone"]}
    for key in ("boards", "width", "height"):
        if key in w:
            props[key] = w[key]
    empty(f"window_{w['id']}", w["pos"], "ARROWS", w["yaw"], props=props)
    empty(f"outside_{w['id']}", w["outsideSpawn"], "SPHERE")

for d in source.get("doors", []):
    empty(f"door_{d['id']}", d["pos"], "CUBE", half=[v / 2 for v in d["size"]],
          props={"cost": d["cost"], "connects": ",".join(d["connects"])})

for i, wb in enumerate(source.get("wallBuys", [])):
    props = {"weapon": wb["weapon"]}
    for key in ("cost", "ammoCost"):
        if key in wb:
            props[key] = wb[key]
    empty(f"wallbuy_{i}_{wb['weapon']}", wb["pos"], "ARROWS", wb["yaw"], props=props)

for c in source.get("crateSpots", []):
    props = {"startsHere": bool(c.get("startsHere", False))}
    if "zone" in c:
        props["zone"] = c["zone"]
    empty(f"crate_{c['id']}", c["pos"], "ARROWS", c.get("yaw", 0), props=props)

for i, d in enumerate(source.get("targetDummies", [])):
    empty(f"dummy_{i}", d["pos"], "ARROWS", d.get("yaw", 0))

for i, lamp in enumerate(source.get("lighting", {}).get("lamps", [])):
    props = {k: lamp[k] for k in ("color", "intensity", "range") if k in lamp}
    empty(f"lamp_{i}", lamp["pos"], "SPHERE", props=props)

bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format="GLB",
    export_extras=True,
    export_yup=True,
    use_selection=False,
    export_cameras=False,
    export_lights=False,
    export_animations=False,
)
if blend_path:
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
print(f"exported {glb_path}")
