"""
Generates the bundled sample asset pack "Ember & Frost" into public/packs/ember-frost.

It exists to prove the pack pipeline end to end: SVG pixel sprites for 2D slots,
glTF models for 3D slots, and lexicon words. Run: python3 scripts/sample-pack/generate.py
"""
import base64, json, math, os, struct

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'packs', 'ember-frost')
os.makedirs(OUT, exist_ok=True)

def svg(name, w, h, rects):
    body = ''.join(f'<rect x="{x}" y="{y}" width="{rw}" height="{rh}" fill="{c}"/>' for x, y, rw, rh, c in rects)
    with open(os.path.join(OUT, name), 'w') as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" shape-rendering="crispEdges">{body}</svg>\n')

# --- owl (npc.raven): 2-frame strip, 20x22 each, feet at (10,20)
def owl(ox, flap):
    r = [
        (ox+6, 8, 8, 9, '#f2f4f8'), (ox+5, 10, 10, 6, '#e4e8f0'), (ox+7, 5, 6, 4, '#f2f4f8'),
        (ox+7, 6, 2, 2, '#ffcf3a'), (ox+11, 6, 2, 2, '#ffcf3a'), (ox+8, 7, 1, 1, '#1a1a22'), (ox+12, 7, 1, 1, '#1a1a22'),
        (ox+9, 9, 2, 1, '#3a3a44'), (ox+8, 12, 1, 1, '#9aa4b8'), (ox+11, 13, 1, 1, '#9aa4b8'), (ox+9, 15, 1, 1, '#9aa4b8'),
        (ox+8, 17, 1, 2, '#e0a030'), (ox+11, 17, 1, 2, '#e0a030'),
    ]
    r += [(ox+2, 6, 4, 6, '#dfe4ee'), (ox+14, 6, 4, 6, '#dfe4ee')] if flap else [(ox+4, 11, 3, 6, '#cfd6e2'), (ox+13, 11, 3, 6, '#cfd6e2')]
    return r
svg('owl.svg', 40, 22, owl(0, True) + owl(20, False))

# --- sled (caravan.t3): 2 frames 36x26, ground at (18,24)
def sled(ox, f):
    r = [
        (ox+4, 18, 22, 2, '#7a4a2a'), (ox+3, 21, 26, 1, '#c8d4e4'), (ox+27, 19, 2, 2, '#c8d4e4'),
        (ox+6, 12, 16, 6, '#b04a3a'), (ox+7, 10, 6, 3, '#e8d8b0'), (ox+14, 11, 6, 2, '#e8d8b0'),
        # husky
        (ox+28-f, 14, 6, 4, '#9aa4b8'), (ox+32-f, 12, 3, 3, '#9aa4b8'), (ox+33-f, 13, 1, 1, '#1a1a22'),
        (ox+28-f, 18, 1, 3, '#7a8498'), (ox+32-f, 18, 1, 3, '#7a8498'),
    ]
    return r
svg('sled.svg', 72, 26, sled(0, 0) + sled(36, 1))

# --- items (16x16)
svg('ember-coins.svg', 16, 16, [(3, 8, 5, 4, '#a8321e'), (3, 8, 5, 3, '#ff6a2a'), (7, 9, 5, 4, '#a8321e'), (7, 9, 5, 3, '#ff8a3a'), (5, 5, 5, 4, '#a8321e'), (5, 5, 5, 3, '#ffb04a'), (6, 5, 2, 1, '#fff0b0')])
svg('ice-bars.svg', 16, 16, [(2, 9, 12, 4, '#9fd4f0'), (2, 12, 12, 1, '#5aa0c8'), (4, 5, 9, 4, '#c8ecff'), (4, 8, 9, 1, '#5aa0c8'), (5, 5, 3, 1, '#ffffff')])

# --- snowy pine (prop.pine) 24x32, ground (12,30)
svg('snow-pine.svg', 24, 32, [
    (11, 24, 2, 6, '#5e3a1e'), (4, 18, 16, 7, '#2f5a4a'), (6, 11, 12, 8, '#3a6a56'), (8, 5, 8, 7, '#457a62'), (10, 2, 4, 4, '#457a62'),
    (5, 18, 14, 2, '#f4f8ff'), (7, 11, 10, 2, '#f4f8ff'), (9, 5, 6, 2, '#f4f8ff'), (10, 2, 4, 1, '#ffffff'),
])

# --- frost vault, top-down (building.bank): 48 wide, footprint bottom at y=64
W, H = 48, 64
rects = [(3, 58, 45, 5, 'rgba(30,40,60,0.25)'), (4, 30, 40, 30, '#cfe6f4'), (4, 30, 40, 1, '#ffffff'), (4, 58, 40, 2, '#8ab4cc')]
rects += [(x, 33, 3, 25, '#ffffff') for x in (8, 16, 29, 37)]
rects += [(19, 46, 10, 14, '#3a5a7a'), (20, 47, 8, 1, '#6a8aaa'), (27, 52, 1, 1, '#ffcf3a')]
for i in range(10):  # pyramid roof of ice
    rects.append((i * 2, 30 - i * 2, W - i * 4, 2, '#7fb8e0' if i % 2 else '#9fd0f0'))
rects += [(18, 8, 13, 13, '#2a3a4a'), (19, 9, 11, 11, '#f6f8fc')]
svg('vault-top.svg', W, H, rects)

# --- frost vault, isometric (building.bank): footprint top corner at (48, 52); diamond 96x48
def poly_svg(name, w, h, polys):
    body = ''.join(f'<polygon points="{" ".join(f"{x},{y}" for x, y in pts)}" fill="{c}"/>' for pts, c in polys)
    with open(os.path.join(OUT, name), 'w') as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}</svg>\n')
ox, oy, z = 48, 52, 30
def P(tx, ty, h=0): return (ox + (tx - ty) * 16, oy + (tx + ty) * 8 - h)
polys = [
    ([P(0.3, 2.7), P(2.7, 2.7), P(2.7, 2.7, z), P(0.3, 2.7, z)], '#cfe6f4'),
    ([P(2.7, 0.3), P(2.7, 2.7), P(2.7, 2.7, z), P(2.7, 0.3, z)], '#a8cce2'),
    ([P(0.2, 2.8, z), P(2.8, 2.8, z), P(1.5, 1.5, z + 26)], '#9fd0f0'),
    ([P(2.8, 2.8, z), P(2.8, 0.2, z), P(1.5, 1.5, z + 26)], '#7fb8e0'),
    ([P(1.2, 2.7), P(1.8, 2.7), P(1.8, 2.7, 14), P(1.2, 2.7, 14)], '#3a5a7a'),
]
poly_svg('vault-iso.svg', 96, 104, polys)

# --- glTF models (units = tiles, origin at footprint centre on the ground)
def gltf(name, parts):
    """parts: list of (positions[], indices[], rgba). No normals: vertices are unshared, so the loader computes flat ones."""
    buf = b''
    accessors, views, meshes_prims, materials = [], [], [], []
    for pos, idx, color in parts:
        p_off = len(buf)
        buf += struct.pack(f'<{len(pos)}f', *pos)
        while len(buf) % 4: buf += b'\0'
        i_off = len(buf)
        buf += struct.pack(f'<{len(idx)}H', *idx)
        while len(buf) % 4: buf += b'\0'
        mins = [min(pos[k::3]) for k in range(3)]
        maxs = [max(pos[k::3]) for k in range(3)]
        views.append({'buffer': 0, 'byteOffset': p_off, 'byteLength': len(pos) * 4, 'target': 34962})
        accessors.append({'bufferView': len(views) - 1, 'componentType': 5126, 'count': len(pos) // 3, 'type': 'VEC3', 'min': mins, 'max': maxs})
        views.append({'buffer': 0, 'byteOffset': i_off, 'byteLength': len(idx) * 2, 'target': 34963})
        accessors.append({'bufferView': len(views) - 1, 'componentType': 5123, 'count': len(idx), 'type': 'SCALAR'})
        materials.append({'pbrMetallicRoughness': {'baseColorFactor': color, 'metallicFactor': 0.0, 'roughnessFactor': 0.8}})
        meshes_prims.append({'attributes': {'POSITION': len(accessors) - 2}, 'indices': len(accessors) - 1, 'material': len(materials) - 1})
    doc = {
        'asset': {'version': '2.0', 'generator': 'wallet-landia sample pack'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}],
        'meshes': [{'primitives': meshes_prims}], 'materials': materials, 'accessors': accessors, 'bufferViews': views,
        'buffers': [{'byteLength': len(buf), 'uri': 'data:application/octet-stream;base64,' + base64.b64encode(buf).decode()}],
    }
    with open(os.path.join(OUT, name), 'w') as f:
        json.dump(doc, f)

def box(x0, y0, z0, x1, y1, z1):
    # 24 vertices (flat faces), 36 indices
    faces = [
        [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],  # +z
        [(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)],  # -z
        [(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)],  # +x
        [(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)],  # -x
        [(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)],  # +y
        [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],  # -y
    ]
    pos, idx = [], []
    for f in faces:
        base = len(pos) // 3
        for v in f: pos += v
        idx += [base, base + 1, base + 2, base, base + 2, base + 3]
    return pos, idx

def cone(r, h, y0, seg):
    pos, idx = [], []
    for i in range(seg):
        a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
        base = len(pos) // 3
        pos += [math.cos(a0) * r, y0, math.sin(a0) * r, 0, y0 + h, 0, math.cos(a1) * r, y0, math.sin(a1) * r]
        idx += [base, base + 1, base + 2]
    return pos, idx

body = box(-1.15, 0, -1.15, 1.15, 1.9, 1.15)
roof = cone(1.75, 1.3, 1.9, 4)
door = box(-0.3, 0, 1.15, 0.3, 0.85, 1.2)
gltf('vault.gltf', [(body[0], body[1], [0.81, 0.9, 0.96, 1]), (roof[0], roof[1], [0.5, 0.72, 0.88, 1]), (door[0], door[1], [0.23, 0.35, 0.48, 1])])

trunk = box(-0.08, 0, -0.08, 0.08, 0.4, 0.08)
c1 = cone(0.55, 0.9, 0.3, 7)
c2 = cone(0.42, 0.75, 0.85, 7)
cap = cone(0.2, 0.3, 1.45, 7)
gltf('snow-pine.gltf', [(trunk[0], trunk[1], [0.37, 0.23, 0.12, 1]), (c1[0], c1[1], [0.2, 0.38, 0.32, 1]), (c2[0], c2[1], [0.27, 0.48, 0.4, 1]), (cap[0], cap[1], [0.96, 0.97, 1, 1])])

pack = {
    'format': 'wallet-landia-pack/1',
    'id': 'ember-frost',
    'name': 'Ember & Frost',
    'author': 'Wallet-landia',
    'version': '0.1.0',
    'license': 'CC0-1.0',
    'description': 'A wintry sample pack: an owl courier, a dog sled, ember coins, ice bars, a frost vault and snowy pines.',
    'slots': {
        'npc.raven': {'sprite': {'src': 'owl.svg', 'ax': 10, 'ay': 20, 'frames': 2}},
        'caravan.t3': {'sprite': {'src': 'sled.svg', 'ax': 18, 'ay': 24, 'frames': 2}},
        'item.native': {'sprite': {'src': 'ember-coins.svg', 'ax': 0, 'ay': 0}},
        'item.stable': {'sprite': {'src': 'ice-bars.svg', 'ax': 0, 'ay': 0}},
        'prop.pine': {'sprite': {'src': 'snow-pine.svg', 'ax': 12, 'ay': 30}, 'model': {'src': 'snow-pine.gltf'}},
        'building.bank': {
            'top': {'src': 'vault-top.svg', 'ax': 0, 'ay': 64, 'sign': {'x': 19, 'y': 9, 'w': 11, 'h': 11}},
            'iso': {'src': 'vault-iso.svg', 'ax': 48, 'ay': 52},
            'model': {'src': 'vault.gltf'},
        },
        'word.building.bank': {'word': 'Frost Vault'},
        'word.building.tower': {'word': 'Ember Clocktower'},
        'word.district.temple': {'word': 'Ember Shrine Hill'},
        'word.district.wilds': {'word': 'The Frostwood'},
    },
}
with open(os.path.join(OUT, 'pack.json'), 'w') as f:
    json.dump(pack, f, indent=2)
with open(os.path.join(OUT, '..', 'index.json'), 'w') as f:
    json.dump(['ember-frost'], f)
print('wrote', sorted(os.listdir(OUT)))
