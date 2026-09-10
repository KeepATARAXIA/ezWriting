import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import 'katex/dist/katex.min.css'
import './components/math.css'
import './components/workbench-workflow.css'
import './components/home-workbench.css'
import './components/workbench-layout.css'
import './components/workbench-simplify.css'
import './components/workbench-docking.css'
import './components/wechat-canvas.css'
import './components/reading-surfaces.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
