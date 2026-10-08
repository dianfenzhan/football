# 球队小程序

原生微信小程序 + 微信云开发。一期范围见 `doc/project/一期确认文档.md`。

AppID：`wxb8021a7ae0c71bd0`（周三快乐足球联队）  
云环境：`cloudbase-d5g20kltv44b494f6`（已写入 `miniprogram/cloud-env.js`）

## 打开与开通云开发

1. 安装并打开[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 导入本目录 `codeBase`，使用 AppID `wxb8021a7ae0c71bd0`。
3. 基础库设到 2.2.3 以上。
4. 工具栏打开云开发，使用环境 `cloudbase-d5g20kltv44b494f6`。
5. 右键 `cloudfunctions/api` →「上传并部署：云端安装依赖」（或跑下方脚本）。

```bash
# 部署云函数（需开发者工具已开 Service Port）
/Applications/wechatwebdevtools.app/Contents/MacOS/cli cloud functions deploy \
  --env cloudbase-d5g20kltv44b494f6 --names api --remote-npm-install \
  --project "$(pwd)" --lang zh

# 冒烟测试（先开自动化端口）
/Applications/wechatwebdevtools.app/Contents/MacOS/cli auto --project "$(pwd)" --auto-port 9421
node scripts/smoke-test.js
```

上传密钥：`doc/project/private.wxb8021a7ae0c71bd0.key`

## 使用说明

- 第一个在「我的」里保存资料的微信号会成为管理员，并且只有这个人能授权其他人成为管理员。
- 管理员新建活动后，把活动页转发给两个群。被授权的管理员也可以新建和管理活动，但不能再授权别人。
- 队员先填姓名和球队，再报名；满员后不能报，可取消。
- 管理员改名额、记每轮比分、记进球助攻，也可以把已报名的人记为缺勤。报名名单所有人都能看到姓名。
- 打开小程序先进入首页：今天起最近的一场，以及进球、助攻、缺勤各前 10。榜单默认近 3 个月，可改成近半年、1 年、2 年、3 年。活动列表在底部「活动」。
- 活动开始后不能报名或取消，也不能改人数。创建和改人数都是滚动选择，每队 1 到 30 人，默认 12。
- 管理员不用报名也能建活动、记数据。在活动页选择队员，再滚动选择进球、助攻，以及这次是否鸽子，默认不鸽子。
