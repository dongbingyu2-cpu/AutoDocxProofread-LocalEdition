# 开发、构建与发布

## 环境

以 Windows x64 为主要目标，使用 Node.js 24、npm 和 Git。固定版本由 .nvmrc、package.json 和 package-lock.json 指定。安装版的最终用户不需要 Node.js。

~~~powershell
git clone https://github.com/dongbingyu2-cpu/AutoDocxProofread-LocalEdition.git
cd AutoDocxProofread-LocalEdition
npm ci
npm run dev
~~~

如果下载 Electron 或打包工具失败，检查网络后重试。模型下载与开发依赖安装是两条独立流程；构建不会下载模型权重。

## 构建

~~~powershell
npm run typecheck
npm test
npm run build
npm run build:win
~~~

源码构建输出到 out/，Windows 安装器和解包目录输出到 release/。build:win 会生成第三方许可声明、确认原生模块和 Electron 工具，再使用 electron-builder 生成 NSIS 安装包。默认发布设置为 never，不会随构建自动发布 GitHub Release。

Electron 主进程入口是 src/main/main.ts，preload 是 src/main/preload.ts，Vue 入口是 src/renderer/renderer.ts。主进程与渲染进程通过明确的 IPC 白名单通信。

## 源码发布边界

公开源码包含 src、测试、构建脚本、依赖锁文件、许可证及经过检查的文档图片。个人数据库、模型配置、登录会话、文档、日志、依赖目录、历史备份和本机验收目录不上传。

此次首次公开使用经过扫描的当前源码快照；本机既有开发历史保留，未作为新仓库历史推送。上游出处和 MIT 声明见 README 和 LICENSE。

发布前应扫描实际候选目录、实际提交历史和安装器中的 app.asar；检查截图中的文档、文件路径及密钥字段。扫描结果为零不能证明不存在所有类型的敏感信息，二进制和截图仍需要单独审查。

## 测试边界

npm test 会在缺失时自动生成虚构 Word 夹具，因此仓库无需携带个人 DOCX。夹具脚本保留已经存在的本地测试文件；复现公开源码测试时应使用干净目录。

单元测试与桌面模拟测试不会证明真实模型的表达质量。真实模型、真实接口、Word 导出和具体硬件性能需要分别验证。不要为了执行测试下载大型模型或提交个人数据。
