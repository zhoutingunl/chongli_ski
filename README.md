# 山脊之间 · 万龙与云顶

河北崇礼红花梁的横屏滑雪网页。选一侧雪场和雪具即可从山顶出发。山丹丹联通万龙至云顶，翠菊花通往万龙。抵达山脚后可留影，或坐索道开始下一趟。

## 本地运行

在本目录运行以下命令。手机与电脑连接同一 Wi-Fi，在手机浏览器打开终端打印的 Network 地址。三维场景需要 WebGL 2。

```sh
npm ci
npm run dev
```

`npm run build` 生成可部署的静态目录 `dist/`。运行时使用随项目提供的地形、影像、贴图与模型。

## 操作

| 操作 | 手机 | 键盘 |
| --- | --- | --- |
| 转弯 | 按住雪面左右拖动 | A / D 或左右方向键 |
| 加速、刹车 | 按住对应按键 | W / S 或上下方向键 |
| 跳跃 | 点「跳」 | 空格 |
| 切换视角 | 点眼形图标 | C |
| 环顾 | 双指拖动 | 在拍照模式中拖动鼠标 |
| 地图、暂停 | 右上角地图、菜单 | M、Esc |

在地图中选择沿线方案，或在实际岔口点按联滑提示。循线辅助默认开启，可以在设置中关闭并自由滑行。拍照界面可选择滑行者、山顶餐厅、山下大厅与酒店作为取景位置。滑行记录和装备偏好保存在当前浏览器。

## 地理与美术

近区地形约 10 公里见方，以 32 米间距采样。外围约 49 公里的高程网格间距为 240 米。游戏提供七条组合线路、70 段测绘雪道及 13 条索道。缺少测量值的雪道宽度采用估算。冬季真彩色影像摄于 2025 年 1 月 21 日，树群分布参考 2021 年林地分类。[高程来源](https://registry.opendata.aws/terrain-tiles/) · [雪道与建筑测绘及 ODbL](https://www.openstreetmap.org/copyright) · [Copernicus Sentinel-2](https://dataspace.copernicus.eu/) · [ESA WorldCover](https://esa-worldcover.org/en)

山顶木屋、金花阁、两侧大厅与相连酒店、吊厢和吊椅按实拍特征重建。角色和动作使用本地生成的三维模型。开场全景与树木图集使用内置 ImageGen 生成。几何与摄影数据可用 `scripts/` 下的脚本重建。[万龙度假区](https://www.wlski.com/) · [云顶金花阁](https://www.secretgardenresorts.com/dinning/?lang=zh-cn) · [完整地理数据署名](public/assets/geo/mountain.json) · [美术来源与生成提示](public/assets/art/credits.txt)
