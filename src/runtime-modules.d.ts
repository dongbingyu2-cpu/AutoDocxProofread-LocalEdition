// 上游包没有发布类型；只为既有运行接口补模块声明，不改其运行行为。
declare module 'docx-edit'
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}
