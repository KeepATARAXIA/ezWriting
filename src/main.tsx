import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import './components/workbench-workflow.css'
import './components/home-workbench.css'
import './components/workbench-layout.css'
import './components/workbench-simplify.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
