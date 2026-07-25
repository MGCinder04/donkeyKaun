import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { GateScreen } from './components/GateScreen.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GateScreen>
      <App />
    </GateScreen>
  </StrictMode>,
)
