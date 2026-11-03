# 「紙コップ」ゲーム（games/cups）の 3D 素材を作る Blender スクリプト（Blender 4.x / 5.x、画面なしで動く）
#
#   blender --background --factory-startup --python tools/blender/cups.py -- <素材フォルダ> <出力.glb>
#
# 素材フォルダに置くもの（Poly Haven、CC0）:
#   wood_Diffuse.jpg, wood_nor_gl.jpg, wood_Rough.jpg … wood_table_001 の 1k
# 作るもの（1 つの glb にまとめる。ゲーム側で名前で取り出す）:
#   Table … 机の天板（木目。UV は実寸 1.5m で 1 回くり返す）
#   Cup   … 逆さにした紙コップ（ふちの巻き込み・内側の壁・底の段差つき。印刷柄と紙の質感のテクスチャは numpy で描く）
#   Ball  … 当たりの赤いスポンジの玉
# 単位はメートル。机の上面が y = 0（glTF の座標）
import bpy, bmesh, sys, os, math
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
src_dir, out_path = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def principled(name, **kw):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    for k, v in kw.items():
        bsdf.inputs[k].default_value = v
    return mat, bsdf


def image_node(mat, path, non_color=False):
    img = bpy.data.images.load(path)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = img
    return node


# ---------------------------------------------------------------- 机
TABLE_W, TABLE_D, TABLE_T = 1.6, 1.0, 0.04
bpy.ops.mesh.primitive_cube_add(size=1)
table = bpy.context.object
table.name = 'Table'
table.scale = (TABLE_W, TABLE_D, TABLE_T)
table.location = (0, 0, -TABLE_T / 2)          # Blender は z が上。上面を z = 0 に
bpy.ops.object.transform_apply(scale=True)
# UV：上から見た実寸（1.5m で 1 回くり返す）。側面も同じ密度になるよう、キューブ投影
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.cube_project(cube_size=1.5)
bpy.ops.object.mode_set(mode='OBJECT')
mat, bsdf = principled('Wood')
nt = mat.node_tree
nt.links.new(image_node(mat, os.path.join(src_dir, 'wood_Diffuse.jpg')).outputs['Color'], bsdf.inputs['Base Color'])
nt.links.new(image_node(mat, os.path.join(src_dir, 'wood_Rough.jpg'), True).outputs['Color'], bsdf.inputs['Roughness'])
nmap = nt.nodes.new('ShaderNodeNormalMap')
nt.links.new(image_node(mat, os.path.join(src_dir, 'wood_nor_gl.jpg'), True).outputs['Color'], nmap.inputs['Color'])
nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
table.data.materials.append(mat)

# ---------------------------------------------------------------- 紙コップ（逆さ）
# 正立のコップの断面（半径 r, 高さ z）を外側の底 → 外壁 → ふち → 内壁 → 内側の底の順に並べ、回転させて作る
H, R_TOP, R_BOT = 0.090, 0.0385, 0.0268
LIP = 0.0021                       # ふちの巻き込みの太さ（半径）
WALL = 0.0006                      # 紙の厚み
SEG = 64
prof = []                          # (r, z, 部位)
# 底の裏（中央 → 段差 → 外壁の下端）
prof += [(0.0, 0.006, 'base'), (R_BOT - 0.0016, 0.006, 'base'), (R_BOT - 0.0016, 0.0, 'base'), (R_BOT, 0.0, 'base')]
# 外壁（下 → 上。ふちの手前まで）
for i in range(1, 25):
    t = i / 24
    prof.append((R_BOT + (R_TOP - R_BOT) * t, (H - LIP * 2) * t, 'outer'))
# ふち（外 → 上 → 内に巻く）
cx, cz = R_TOP + LIP * 0.2, H - LIP
for i in range(1, 13):
    a = -math.pi * 0.5 + math.pi * 1.6 * i / 12
    prof.append((cx + LIP * math.cos(a), cz + LIP * math.sin(a) + LIP * 0.0, 'lip'))
# 内壁（上 → 下）
for i in range(0, 21):
    t = i / 20
    r = (R_TOP - WALL) - (R_TOP - R_BOT) * t
    prof.append((r, (H - LIP * 2) * (1 - t) + 0.008 * t, 'inner'))
# 内側の底
prof += [(0.0, 0.008, 'inbase')]

# 断面の長さで v を決める（テクスチャを部位ごとに塗り分けるため、部位の範囲を記録する）
lengths = [0.0]
for (r0, z0, _), (r1, z1, _) in zip(prof, prof[1:]):
    lengths.append(lengths[-1] + math.hypot(r1 - r0, z1 - z0))
total = lengths[-1]
vs = [l / total for l in lengths]
ranges = {}
for (r, z, part), v in zip(prof, vs):
    lo, hi = ranges.get(part, (v, v))
    ranges[part] = (min(lo, v), max(hi, v))

me = bpy.data.meshes.new('Cup')
bm = bmesh.new()
rings = []
for (r, z, _) in prof:
    ring = []
    for k in range(SEG):
        a = 2 * math.pi * k / SEG
        # 逆さにする（z → H - z）
        ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), H - z)))
    rings.append(ring)
bm.verts.ensure_lookup_table()
uv_layer = bm.loops.layers.uv.new('UVMap')
for j in range(len(prof) - 1):
    for k in range(SEG):
        k1 = (k + 1) % SEG
        f = bm.faces.new((rings[j][k], rings[j][k1], rings[j + 1][k1], rings[j + 1][k]))
        uvs = [(k / SEG, vs[j]), ((k + 1) / SEG, vs[j]), ((k + 1) / SEG, vs[j + 1]), (k / SEG, vs[j + 1])]
        for loop, uv in zip(f.loops, uvs):
            loop[uv_layer].uv = uv
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)       # 中心（r = 0）の点をまとめる
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me)
bm.free()
cup = bpy.data.objects.new('Cup', me)
scene.collection.objects.link(cup)
bpy.context.view_layer.objects.active = cup
cup.select_set(True)
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))

# 紙コップのテクスチャ（u = 周、v = 断面）。白い紙に、赤い帯 2 本と、のりしろの重なり、紙の繊維のむら
TW, TH = 1024, 512
rng = np.random.default_rng(7)
img_px = np.ones((TH, TW, 3), dtype=np.float32) * np.array([0.96, 0.955, 0.94])
vv = (np.arange(TH) + 0.5) / TH                      # 画像の行 → v（Blender の画像は下から上）
uu = (np.arange(TW) + 0.5) / TW
o0, o1 = ranges['outer']
# 外壁での位置（0 = コップの底側, 1 = 口側）
ow = (vv - o0) / (o1 - o0)
on_outer = (ow >= 0) & (ow <= 1)
def band(lo, hi):
    return on_outer & (ow >= lo) & (ow <= hi)
red = np.array([0.72, 0.08, 0.09])
for lo, hi in [(0.80, 0.86), (0.89, 0.905), (0.10, 0.13)]:
    rows = band(lo, hi)
    img_px[rows] = red
# 内側は少し暗い（光が入りにくい）
i0, i1 = ranges['inner']
img_px[(vv >= i0) & (vv <= ranges['inbase'][1] + 0.01)] *= 0.86
# のりしろ（u = 0 付近の 6mm ほど）：わずかに暗い線
seam_u = 0.006 / (2 * math.pi * (R_TOP + R_BOT) / 2)
img_px[:, (uu < seam_u)] *= 0.93
img_px[:, (uu >= seam_u) & (uu < seam_u + 0.0015)] *= 0.85
# 紙の繊維のむら（細かいノイズを少しぼかす）
noise = rng.normal(0, 1, (TH, TW)).astype(np.float32)
for _ in range(2):
    noise = (noise + np.roll(noise, 1, 0) + np.roll(noise, 1, 1) + np.roll(noise, -1, 0) + np.roll(noise, -1, 1)) / 5
img_px *= (1 + noise[..., None] * 0.035)
img_px = np.clip(img_px, 0, 1)
cup_img = bpy.data.images.new('cup_paper', TW, TH, alpha=False)
cup_img.pixels.foreach_set(np.concatenate([img_px, np.ones((TH, TW, 1))], axis=2).astype(np.float32).ravel())
cup_img.filepath_raw = os.path.join(os.path.dirname(out_path), 'cup_paper.png')
cup_img.file_format = 'PNG'
cup_img.save()
mat, bsdf = principled('Paper', Roughness=0.62)
mat.node_tree.links.new(image_node(mat, cup_img.filepath_raw).outputs['Color'], bsdf.inputs['Base Color'])
cup.data.materials.append(mat)

# ---------------------------------------------------------------- 当たりの玉（赤いスポンジ）
bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.0165, location=(0, 0, 0.0165))
ball = bpy.context.object
ball.name = 'Ball'
bpy.ops.object.shade_smooth()
mat, bsdf = principled('Sponge', **{'Base Color': (0.75, 0.05, 0.06, 1), 'Roughness': 0.9})
ball.data.materials.append(mat)

# 机の上に並べたプレビュー用の位置は使わない（ゲーム側で置く）。すべて原点に置いて書き出す
cup.location = (0, 0, 0)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True, export_apply=True,
                          export_image_format='AUTO', export_texcoords=True, export_normals=True)
print('CUPS_OK', out_path, os.path.getsize(out_path), {k: tuple(round(x, 3) for x in v) for k, v in ranges.items()})
