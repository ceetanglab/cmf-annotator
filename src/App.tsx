import { useCallback, useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import Toolbar from './components/Toolbar'
import LeftPanel from './components/LeftPanel'
import ZoomBar from './components/ZoomBar'
import AnnotationCanvas from './components/AnnotationCanvas'
import WatermarkPanel from './components/WatermarkPanel'
import ProjectInfoPanel from './components/ProjectInfoPanel'
import TemplatePanel from './components/TemplatePanel'
import Icon from './components/ui/Icon'
import PropertyPanel from './components/PropertyPanel'
import BoardPanel from './components/BoardPanel'
import GlobalStylePanel from './components/GlobalStylePanel'
import AlignPanel from './components/AlignPanel'
import { infoName, nameProjectFromFile, useStore } from './store'
import type { CanvasControls } from './canvasControls'
import { readImageFile, readJSONFile, loadImageElement } from './lib/io'
import { clearLocal, loadLocal } from './lib/storage'
import { bumpDocs, listDocs, loadDoc, saveDoc } from './lib/docs'
import { claimWindowNumber, startWindowHeartbeat } from './lib/windowSlots'
import { newDocId, putDocIdInUrl, readDocId } from './lib/docId'
import { initHistory, resetHistory } from './history'
import { IMAGE_GAP } from './layout'
import type { CMFProject, ImageItem } from './types'
import { uid } from './lib/id'

export default function App() {
  const stageRef = useRef<Konva.Stage>(null)
  const controlsRef = useRef<CanvasControls | null>(null)
  const imgInput = useRef<HTMLInputElement>(null)
  // 本窗口的工程槽位（?doc=xxx）。初始化是异步的，保存一律读 ref，避免 effect 抢在载入前把空工程写进去
  const docIdRef = useRef('')
  const readyRef = useRef(false)
  const savingRef = useRef(false)
  const dirtyRef = useRef(false)
  const hadContentRef = useRef(false)
  const [docId, setDocId] = useState('')

  const loadProject = useStore((s) => s.loadProject)
  const exportProject = useStore((s) => s.exportProject)
  const importTemplate = useStore((s) => s.importTemplate)
  const images = useStore((s) => s.images)
  const annotations = useStore((s) => s.annotations)
  const shapes = useStore((s) => s.shapes)
  const info = useStore((s) => s.info)
  const infoVisible = useStore((s) => s.infoVisible)
  const infoScale = useStore((s) => s.infoScale)
  const infoPos = useStore((s) => s.infoPos)
  const logo = useStore((s) => s.logo)
  const watermark = useStore((s) => s.watermark)
  const addImages = useStore((s) => s.addImages)
  const selectedIds = useStore((s) => s.selectedIds)
  const groups = useStore((s) => s.groups)
  const artboards = useStore((s) => s.artboards)
  const exportName = useStore((s) => s.exportName)
  const globalLineColor = useStore((s) => s.globalLineColor)

  // 右栏三页：「标注」只放单个标注的属性；「画板」放选中画板的设置；
  // 其余情况（点空白 / 多选对象 / 选中图片或信息栏）都是「全局」。
  // 选中变化时自动跳页；用户手动点页签也能覆盖，直到下一次选中变化
  const [sideTab, setSideTab] = useState<'global' | 'ann' | 'board'>('global')
  const singleAnn = selectedIds.length === 1 && annotations.some((a) => a.id === selectedIds[0])
  // 形状不单独占一页：点中形状时同样落到「标注」页，由它按选中类型显示对应表单
  const hasShape = selectedIds.length > 0 && shapes.some((sh) => selectedIds.includes(sh.id))
  // 画板页由 store 的 boardFocus 驱动：点画板（画布或左栏列表）就切过去，选对象就切回来
  const boardFocus = useStore((s) => s.boardFocus)
  const focusBoards = useStore((s) => s.focusBoards)
  useEffect(() => {
    setSideTab(boardFocus ? 'board' : hasShape || singleAnn ? 'ann' : 'global')
  }, [singleAnn, hasShape, selectedIds[0], selectedIds.length, boardFocus])

  // 双击画布上的形状时，即便当前选中态没变（例如用户手动切到了别的页），也强制切回「标注」页
  useEffect(() => {
    const jump = () => setSideTab('ann')
    window.addEventListener('cmf:edit-shape', jump)
    return () => window.removeEventListener('cmf:edit-shape', jump)
  }, [])

  // 启动：先定下本窗口的工程槽位（?doc=xxx），再把这份工程读回来。
  // 网址上没有 ?doc 就当作「新工程」——两个窗口各有各的槽位，才不会互相覆盖
  useEffect(() => {
    let alive = true
    let stopBeat: (() => void) | null = null
    void (async () => {
      const id = readDocId() ?? newDocId()
      // 窗口号（默认名的 -01 / -02…）：所有窗口都排队领号，关窗时自动让位
      const winNum = claimWindowNumber(id)
      stopBeat = startWindowHeartbeat(id, winNum)
      docIdRef.current = id
      putDocIdInUrl(id)
      if (!alive) return
      setDocId(id)

      const saved = await loadDoc(id)
      if (!alive) return

      if (saved) {
        // 等待期间用户可能已经自己动手了，别把他刚拖进来的图顶掉
        if (!useStore.getState().images.length) loadProject(saved)
        hadContentRef.current = true
      } else {
        // 升级到多工程之前只有一份 localStorage 存档：搬进第一个槽位，别让老用户丢画面
        const legacy = loadLocal()
        if (legacy && (legacy.images?.length || legacy.image)) {
          loadProject(legacy)
          hadContentRef.current = true
          void saveDoc(id, legacy, infoName(legacy.info ?? useStore.getState().info))
            .then(bumpDocs)
            .catch(() => {})
          clearLocal()
        } else {
          // 全新窗口：默认名「未命名项目-01 / -02 / -03…」，两位补零，一眼能按号排。
          // 窗口号来自共享排号表；库里已经有人叫这个名字就继续往上找空号
          const names = await listDocs()
            .then((list) => list.map((d) => d.name))
            .catch((): string[] => [])
          if (!alive) return
          let n = Math.max(1, winNum)
          let name = `未命名项目-${String(n).padStart(2, '0')}`
          while (names.includes(name)) name = `未命名项目-${String(++n).padStart(2, '0')}`
          const st = useStore.getState()
          const field = st.info.fields.find((f) => f.label === '项目') ?? st.info.fields[0]
          if (field && !field.value.trim()) st.updateInfoField(field.id, { value: name })
        }
      }
      initHistory()
      readyRef.current = true
    })()
    return () => {
      alive = false
      stopBeat?.()
    }
  }, [loadProject])

  // 写库：同一时刻只允许一次写入，期间的改动打个标记，写完再补一次。
  // 拖动图片时状态每帧都在变，不管住会堆出一串并行事务
  const flush = useCallback(async () => {
    const id = docIdRef.current
    if (!id) return
    if (savingRef.current) {
      dirtyRef.current = true
      return
    }
    savingRef.current = true
    try {
      do {
        dirtyRef.current = false
        // 项目名是信息栏里那一栏，没填时 infoName 会退回「未命名项目」—— 列表里要一个能认的名字
        const name = infoName(useStore.getState().info)
        await saveDoc(id, exportProject(), name)
      } while (dirtyRef.current)
      bumpDocs()
    } catch {
      /* 写失败（无痕模式 / 配额不足）不打断编辑：用户仍能导出项目文件保住成果 */
    } finally {
      savingRef.current = false
    }
  }, [exportProject])

  useEffect(() => {
    if (!readyRef.current) return
    // 全空的工程不落库：否则每开一个新窗口都会在「最近工程」里留一条空记录。
    // 但曾经有内容的工程必须写（哪怕刚被「清空画面」），否则库里会留着旧内容，下次打开又冒出来
    // 画板也算内容：只加了一块画板、还没放图，刷新后画板不该凭空消失
    const empty = !images.length && !annotations.length && !shapes.length && !artboards.length
    if (empty && !hadContentRef.current) return
    if (!empty) hadContentRef.current = true
    void flush()
  }, [
    images,
    annotations,
    shapes,
    groups,
    artboards,
    info,
    infoVisible,
    infoScale,
    infoPos,
    logo,
    watermark,
    exportName,
    globalLineColor,
    flush
  ])

  // 窗口标题跟着工程名走：多开时靠 Dock / 任务栏上的标题认窗口
  useEffect(() => {
    document.title = `${infoName(info)} · CMF 标注工具`
  }, [info])

  // 滑块的「已滑过」填充段：原生 range 画不出来，这里把百分比写进 `--p`，由 CSS 的
  // linear-gradient 渲染。用事件委托 + MutationObserver，面板里任意滑块（含动态挂载的）都能覆盖，
  // 不用每个面板单独接线
  useEffect(() => {
    const paint = (el: HTMLInputElement) => {
      const min = Number(el.min || 0)
      const max = Number(el.max || 100)
      const v = Number(el.value)
      const p = max > min ? Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)) : 0
      const next = `${p}%`
      if (el.style.getPropertyValue('--p') !== next) el.style.setProperty('--p', next)
    }
    const paintAll = () => document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(paint)
    const onInput = (e: Event) => {
      const t = e.target
      if (t instanceof HTMLInputElement && t.type === 'range') paint(t)
    }
    document.addEventListener('input', onInput, true)
    paintAll()
    const mo = new MutationObserver(paintAll)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => {
      document.removeEventListener('input', onInput, true)
      mo.disconnect()
    }
  }, [])

  // 导入图片（点击上传 / 拖入共用）：按行拼接到当前最右图之后
  const addImageFiles = useCallback(
    async (files: File[]) => {
      const imgs = files.filter((f) => f.type.startsWith('image/'))
      if (!imgs.length) return 0
      const metas = await Promise.all(
        imgs.map(async (f) => {
          const { dataUrl, name } = await readImageFile(f)
          const el = await loadImageElement(dataUrl)
          return { dataUrl, name, width: el.width, height: el.height }
        })
      )
      const cur = useStore.getState().images
      let cursorX = cur.length ? Math.max(...cur.map((i) => i.x + i.w)) + IMAGE_GAP : 0
      const items: ImageItem[] = metas.map((m) => {
        const item: ImageItem = {
          id: uid(),
          dataUrl: m.dataUrl,
          name: m.name,
          x: cursorX,
          y: 0,
          w: m.width,
          h: m.height
        }
        cursorX += m.width + IMAGE_GAP
        return item
      })
      addImages(items)
      return items.length
    },
    [addImages]
  )

  const importProjectFile = useCallback(
    async (f: File) => {
      const raw = await readJSONFile<Record<string, unknown>>(f)
      // 同一套拖放 / 文件选择入口，靠 kind 分辨工程与模板
      if (raw && raw.kind === 'cmf-template') {
        const t = importTemplate(raw)
        alert(
          t
            ? `已导入模板「${t.name}」\n在左栏「模板」里点「应用」即可套用。`
            : '模板文件格式不正确'
        )
        return
      }
      // 工程里没写项目名时用文件名兜底：导出的文件名本来就跟着项目名走
      loadProject(nameProjectFromFile(raw as unknown as CMFProject, f.name))
      resetHistory()
    },
    [loadProject, importTemplate]
  )

  const handleImportImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length) await addImageFiles(files)
  }

  // ---- 从系统拖文件进窗口：图片按顺序拼接，.json 直接打开工程 ----
  const [dropping, setDropping] = useState(false)
  const dragDepth = useRef(0)

  const handleDropped = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      const json = files.find((f) => /\.json$/i.test(f.name) || f.type === 'application/json')
      if (json) {
        try {
          await importProjectFile(json)
        } catch {
          alert('JSON 解析失败，请检查文件格式')
        }
        return
      }
      const n = await addImageFiles(files)
      if (!n) alert('只支持拖入图片（PNG / JPG / WebP）或工程文件（.json）')
    },
    [addImageFiles, importProjectFile]
  )

  useEffect(() => {
    // 只接管「从系统拖文件进来」；面板内部的行排序不带 Files，不会被误处理
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current += 1
      setDropping(true)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (!dragDepth.current) setDropping(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDropping(false)
      void handleDropped(Array.from(e.dataTransfer?.files ?? []))
    }
    // 拖出窗口 / 切走窗口时兜底复位，否则蒙层会一直挂着
    const reset = () => {
      dragDepth.current = 0
      setDropping(false)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
      window.removeEventListener('blur', reset)
    }
  }, [handleDropped])

  const pickImage = () => imgInput.current?.click()

  // 画布中央那块引导提示只在「真的一张白纸」时出现：图 / 标注 / 形状 / 画板，
  // 只要有了任何一样就算开工了，提示让位（加一块空画板也算，别挡着人拖画板）
  const noContent = !images.length && !annotations.length && !shapes.length && !artboards.length

  return (
    <div className="app">
      <LeftPanel onPickImage={pickImage} docId={docId} onFlush={flush} controlsRef={controlsRef} />

      <main className="stage">
        <AnnotationCanvas stageRef={stageRef} controlsRef={controlsRef} />

        <Toolbar
          onFit={() => controlsRef.current?.fit()}
          onActualSize={() => controlsRef.current?.actualSize()}
        />

        <ZoomBar controlsRef={controlsRef} />

        {noContent ? (
          <div className="canvas-hint">
            <strong>导入渲染图 / 工程</strong>
            <span>可一次选择多张图（同一产品的不同角度）并排拼接</span>
            <span>滚轮缩放 · 空白处拖动平移 · 选好工具后在画布上双击起笔</span>
            <span>也可以直接把图片 / 工程文件拖进窗口，或从左栏「项目」打开最近的工程</span>
          </div>
        ) : null}

        {/* 拖文件进入时的提示蒙层（只覆盖画布区，不拦截鼠标） */}
        {dropping && (
          <div className="drop-overlay">
            <div className="drop-card">
              <Icon name="image" size={22} />
              <strong>松开即可导入</strong>
              <span>图片按顺序拼接到右侧 · .json 打开工程或导入模板</span>
            </div>
          </div>
        )}
      </main>

      <aside className="right">
        <div className="right-head">
          <div className="right-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'global'}
              className={`right-tab${sideTab === 'global' ? ' on' : ''}`}
              onClick={() => setSideTab('global')}
              title="不选任何对象时看到的设置：对齐、项目信息栏、引线样式、水印、模板"
            >
              <Icon name="layers" size={14} />
              全局
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'ann'}
              className={`right-tab${sideTab === 'ann' ? ' on' : ''}`}
              onClick={() => setSideTab('ann')}
              title="选中标注或形状后，在这里编辑它的属性：标注改颜色 / 材质 / 工艺，形状改颜色 / 粗细 / 透明度 / 文字"
            >
              <Icon name="tag" size={14} />
              标注
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'board'}
              className={`right-tab${sideTab === 'board' ? ' on' : ''}`}
              onClick={focusBoards}
              title="画板比例、底色与自动画布（选中多块可批量设置）"
            >
              <Icon name="frame" size={14} />
              画板
            </button>
          </div>
        </div>

        {sideTab === 'global' ? (
          <>
            <AlignPanel />
            <ProjectInfoPanel />
            <GlobalStylePanel />
            <WatermarkPanel />
            <TemplatePanel />
          </>
        ) : sideTab === 'ann' ? (
          <PropertyPanel />
        ) : (
          <BoardPanel />
        )}
      </aside>

      <input
        ref={imgInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden-input"
        onChange={handleImportImage}
      />
    </div>
  )
}
