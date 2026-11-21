# 山脊之间 · 万龙与云顶

河北崇礼红花梁的三维滑雪网页。万龙与云顶位于山脊两侧，在同一张地形上相连。手机横屏、竖屏和电脑键盘都可以玩。[直接体验网页版 1.8.0](https://qupfile.cloudvdn.com/chongli-ridgeline_20261121_231324.html)

![万龙山顶的第一人称游戏画面，索道站前的雪面上标有金龙道和长龙道](docs/media/wanlong-summit.jpg)

首页可选择出发雪场、单板或双板、角色和雪服配色。男士、女士和约 5–6 岁的男孩、女孩有各自的身形，儿童使用短雪板和短雪杖。每次打开时，尚未手动选择的项目各自随机，选过的项目沿用上次的设置。

进入山顶后可原地环顾木屋、索道站和山脊，看雪面道名和箭头选方向。按方向键或点左下箭头即可起滑。第一次到万龙，可以先朝长龙道滑出，再向左转入金龙道。地图也可手选道口。山丹丹由万龙顺坡通往云顶。翠菊花由云顶通往万龙，在游戏中从万龙反向进入需蹬坡。抵达山脚会自动收速并停在雪面上。拖动可让滑手与机位一起原地转向，环顾大厅与相连的酒店，查看本趟成绩，乘索道上山或重滑本线。

## 本地运行

使用 Node.js 22.12 或更高版本，也支持 Node.js 20.19 及后续 20.x 版本。项目使用 npm、Vite 和 Three.js。三维场景需要支持 WebGL 2 的浏览器。

```sh
git clone https://github.com/zhoutingunl/chongli_ski.git
cd chongli_ski
npm ci
npm run dev
```

电脑浏览器打开终端打印的 Local 地址。手机与电脑连接同一 Wi-Fi 后，在手机浏览器打开 Network 地址。游戏运行时使用仓库自带的地形、影像与材质。

验证生产构建时运行以下命令。部署时将整个 `dist/` 目录作为静态站点根目录。

```sh
npm run build
npm run preview
```

## 操作

| 操作 | 手机 | 键盘 |
| --- | --- | --- |
| 从当前位置起滑 | 转向雪面上的道口，点左下方向键起滑 | 任一方向键或 WASD |
| 转弯 | 点左右方向键，或在左侧雪面拖动 | A / D 或左右方向键 |
| 压板头、压板尾 | 在左侧雪面向上、向下拖动 | I / K |
| 加速、刹车 | 按住对应按键 | W / S 或上下方向键 |
| 跳跃 | 按住「跳」蓄力，松开起跳 | 按住并松开空格 |
| 切换视角 | 右上角切第一人称和外部机位，眼形图标轮换九种机位 | V 或 C |
| 360° 环顾 | 右手拖动环顾、左手同时转弯。也可在同侧双指环顾，点指南针回正 | 鼠标拖动，或 J / L、U / O，R 回正 |
| 地图、暂停 | 右上角地图、菜单 | M、Esc |

两处山顶的道名与箭头直接印在对应方向的雪面上。滑行中，临近有多条可选雪道的岔口时，雪面才会出现一组指引。每个去向显示一次道名和方向箭头，选路通过后收起。按住方向键可在进道前改道、横切或调头。上坡时按住加速蹬行，松开会消耗余速。地图也可指定出发道口。追尾与侧视机位中，滑手依据速度和实际转弯负荷倾身。双板在弯中屈伸双腿，单板从前刃过渡到后刃时移动重心，夹克从腰部到衣领连续弯曲。首次进入采用第一人称，浏览器会记住已选择的机位。循线辅助默认开启，可以在设置中关闭并自由滑行。拍照界面可选择滑行者、山顶餐厅、山下大厅与酒店作为取景位置。双指可平移、缩放拍照镜头，电脑可用 WASD 平移、Q / E 升降。设置提供经授权的体感转向、中英文、画质、声音、九首背景音乐和音量。时段和天气独立设置，自动模式随游戏时钟切换。滑行记录和偏好保存在当前浏览器。

直滑会留下压痕，立刃时雪会沿弯道外侧堆起，横刹会推出雪扇。道边的软雪比道中央的压实雪更容易陷入。天气设为晴、时段设为白天后，转动视线可看到雪道和树枝积雪上的冰晶随光线闪动。

## 自动化测试

安装依赖后运行 `npm test`。测试使用 Node.js 内置的测试运行器，可以在终端离线执行。角色测试直接驱动游戏使用的三维模型，测量手套、雪鞋和杖尖在雪面上的位置。

| 测试文件 | 验证内容 |
| --- | --- |
| [navigation.test.js](test/navigation.test.js) | 在实际雪道数据上回放单、双板连续改道，核对岔口路标顺序、反向蹬坡、原地转身和 64 条公众雪道的起终点信息 |
| [descent.test.js](test/descent.test.js) | 在已知坡度上比较刹车、蓄力起跳和道边陷雪，验证抵达山脚后停留及重滑 |
| [rider.test.js](test/rider.test.js) | 对比成人与儿童雪具，测量男孩、女孩直滑、加速和左右换刃时的姿态 |
| [mountain.test.js](test/mountain.test.js) | 检查高程三角面、边界采样、雪道里程与最近点、建筑和树干碰撞，以及随包林地图的尺寸 |
| [environment.test.js](test/environment.test.js) | 检查昼夜和降雪的独立周期、晴雪光照差异与无效输入回退 |

只复现万龙选道或儿童姿态时，可以分别运行 `node --test test/navigation.test.js` 或 `node --test test/rider.test.js`。

## 小红书小工具

离线包与网页版共用雪道、滑行物理和人物模型。打包需要 Python 3、Pillow，以及命令行工具 `zip` 和 `unzip`。将官方打包技能解压到仓库上一级的 `.codex/` 目录，使校验脚本位于 `../.codex/minitool-zip-builder/scripts/audit_artifact.py`。[下载官方打包技能 1.11.1](https://fe-static.xhscdn.com/minitool/20261117152455/minitool-zip-builder-1.11.1.skill)

```sh
node scripts/build-xiaohongshu.mjs ../chongli-ski-1.8.0.zip
```

脚本先校验离线目录，再校验最终 ZIP 并检查解压完整性。小工具中的「保存到相册」通过宿主的相册接口写入游戏截图。[方形图标](docs/media/icon.jpg) · [竖版封面](docs/media/cover.jpg) · [儿童双板换刃游戏录像](docs/media/junior-ski.mp4)

## 源码入口

- 首页选择、输入及山顶、滑行、山脚和索道的切换集中在 [main.js](src/main.js)。
- 修改雪道走向时，从地形采样、道口连通和滑行计算三个模块入手。[mountain.js](src/mountain.js) · [navigation.js](src/navigation.js) · [simulation.js](src/simulation.js)
- 三维场景与机位由 world 组织，滑手、山体林地和度假区设施在对应模块中构建。[world.js](src/world.js) · [rider.js](src/rider.js) · [landscape.js](src/landscape.js) · [resort.js](src/resort.js)
- 地形、影像和美术素材随游戏发布。小工具另有宿主接口和轻量场景。[public/assets](public/assets) · [src/xhs](src/xhs)

## 地理与美术

近区地形约 10 公里见方，以 32 米间距采样。外围约 49 公里的高程网格间距为 240 米。游戏提供万龙、云顶各 32 条公众雪道、八条组合线路及 13 条索道。59 条公众雪道使用独立测线，柳兰、金莲花采用共用走廊，雾龙、赤龙、花苜蓿依据雪场图估绘。雾龙道可以从地图进入起点。缺少测量值的雪道宽度采用估算。冬季真彩色影像摄于 2025 年 1 月 21 日，树群分布参考 2021 年林地分类。[高程来源](https://registry.opendata.aws/terrain-tiles/) · [雪道与建筑测绘及 ODbL](https://www.openstreetmap.org/copyright) · [Copernicus Sentinel-2](https://dataspace.copernicus.eu/) · [ESA WorldCover](https://esa-worldcover.org/en)

山顶木屋、金花阁、两侧大厅与相连酒店、吊厢和吊椅按实拍特征重建。云顶 1 索南侧到花锚的约 77 米山顶连接段按冬季影像中的开放雪面拟合。角色采用本地三维模型，动作依据滑行实拍调校，双板内外腿的屈伸也参考了[高山滑雪实地运动学研究](https://doi.org/10.3389/fspor.2020.00056)。开场全景与树木图集使用内置 ImageGen 生成。几何与摄影数据可用 `scripts/` 下的脚本重建。[万龙度假区](https://www.wlski.com/) · [云顶金花阁](https://www.secretgardenresorts.com/dinning/?lang=zh-cn) · [完整地理数据署名](public/assets/geo/mountain.json) · [美术来源与生成提示](public/assets/art/credits.txt)
