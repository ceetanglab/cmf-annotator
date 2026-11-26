import { useState } from 'react'
import Section from './ui/Section'
import Icon from './ui/Icon'
import QrDialog from './ui/QrDialog'

/** 版本号由 vite.config 在构建时从 package.json 注入，改版本只需 npm version */
const VERSION = __APP_VERSION__
const BUILT_AT = __BUILD_TIME__
/** 源码仓库：填了就会显示成可点链接，留空则显示「链接待补充」 */
const REPO_URL: string = 'https://github.com/ceetanglab/cmf-annotator'

/**
 * 「关于」：左栏最后一张分组卡，形态与「导出设置 / 快捷键」一致（默认折叠）。
 * 内容：版本 / 信息说明 / 版权 / 开源协议 / 反馈。
 */
export default function AboutPanel() {
  const [qr, setQr] = useState(false)

  return (
    <>
      <Section title="关于" defaultOpen={false}>
        <div className="ab-head">
          <strong>CMF 标注工具</strong>
          <span className="ab-ver" title={`版本 ${VERSION} · 构建 ${BUILT_AT}`}>v{VERSION}</span>
        </div>
        <p className="ab-sub">渲染图 → 可交付的 CMF 标注总表</p>

        <div className="ab-item">
          <span className="ab-k">信息说明</span>
          <p>导入渲染图，拉引线标注部件、填写材质与工艺，导出 PNG / PDF / 分层 SVG 交付。</p>
          <p>所有处理都在本机浏览器完成，图片不会上传到任何服务器。</p>
          <p>工程自动保存在本浏览器，换设备或清缓存后会看不到旧存档 —— 重要项目请用「导出工程」备份 JSON。</p>
        </div>

        <div className="ab-item">
          <span className="ab-k">版权信息</span>
          <p>© 2026 造型食堂 · 保留所有权利</p>
          <p className="ab-build">构建于 {BUILT_AT}</p>
        </div>

        <div className="ab-item">
          <span className="ab-k">开源协议</span>
          <p>MIT License · 可自由使用、修改、分发与商用，须保留版权与许可声明。</p>
          <p>
            完整条款见仓库根目录 <code>LICENSE</code> 文件。
          </p>
        </div>

        <div className="ab-item">
          <span className="ab-k">反馈意见</span>
          <p className="ab-fb">
            如需反馈意见，请关注
            {/* 名字本身是入口：点开就是公众号二维码，比让用户自己去微信搜索省事 */}
            <button
              type="button"
              className="ab-qr-link"
              title="点击查看公众号二维码"
              onClick={() => setQr(true)}
            >
              “造型食堂”
            </button>
            公众号留言。
          </p>
        </div>

        {/* 在线版才给介绍页入口：离线单文件里没有 about.html，给了就是死链 */}
        {typeof location !== 'undefined' && location.protocol.startsWith('http') ? (
          <a className="ab-repo is-link" href="./about.html">
            <span>工具介绍</span>
            <span className="ab-repo-go">
              它能做什么
              <Icon name="chevron" size={10} />
            </span>
          </a>
        ) : null}

        {REPO_URL ? (
          <a className="ab-repo is-link" href={REPO_URL} target="_blank" rel="noreferrer">
            <span>源码仓库</span>
            <span className="ab-repo-go">
              GitHub
              <Icon name="chevron" size={10} />
            </span>
          </a>
        ) : (
          <div className="ab-repo">
            <span>源码仓库</span>
            <em>链接待补充</em>
          </div>
        )}
      </Section>

      <QrDialog open={qr} onClose={() => setQr(false)} />
    </>
  )
}
