// 画布对外暴露的命令式控制接口（由 AnnotationCanvas 实现，供工具栏/面板调用）
export interface CanvasControls {
  fit: () => void // 适应视图（内容 + 所有画板居中铺满）
  actualSize: () => void // 还原为 1:1 实际大小
  zoomBy: (factor: number) => void // 以视口中心缩放（底部缩放条用）
  /** 把视图对到某块画板（左侧画板列表点一下就能看到它在哪） */
  showBoard: (id: string) => void
  /**
   * 导出画板：
   * - scope='selected' 出当前选中的画板（默认），'all' 出全部
   * - unify=true 时全部画板统一用「当前画板」的分辨率与格式（默认）
   */
  exportBoards: (scope?: 'selected' | 'all', unify?: boolean) => Promise<void> | void
}
