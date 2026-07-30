import { useState } from 'preact/hooks'
import { Header } from './components/Header'
import { PrivacyBar } from './components/PrivacyBar'
import { TabNav, type ToolId, type Tool } from './components/TabNav'
import { ToolPlaceholder } from './components/ToolPlaceholder'
import { VerifyPanel } from './components/VerifyPanel'
import { Footer } from './components/Footer'
import { ImagesTool } from './tools/images/ImagesTool'
import { HeicTool } from './tools/heic/HeicTool'
import { CleanTool } from './tools/clean/CleanTool'
import { DeblurTool } from './tools/deblur/DeblurTool'

const TOOLS: Tool[] = [
  { id: 'images', label: 'Images', blurb: 'Convert, compress and resize JPG, PNG and WebP.' },
  { id: 'heic', label: 'HEIC → JPG', blurb: 'Turn iPhone HEIC photos into JPG or PNG.' },
  { id: 'deblur', label: 'Deblur', blurb: 'Recover detail lost to focus or motion blur.' },
  { id: 'clean', label: 'Clean', blurb: 'Strip GPS, device info and hidden metadata before you share.' },
  { id: 'pdf', label: 'PDF', blurb: 'Merge and split PDF files.' },
]

export function App() {
  const [active, setActive] = useState<ToolId>('images')
  const current = TOOLS.find((t) => t.id === active)!

  return (
    <div class="app">
      <Header />
      <PrivacyBar />
      <main class="container">
        <TabNav tools={TOOLS} active={active} onSelect={setActive} />
        {active === 'images' ? (
          <ImagesTool />
        ) : active === 'heic' ? (
          <HeicTool />
        ) : active === 'deblur' ? (
          <DeblurTool />
        ) : active === 'clean' ? (
          <CleanTool />
        ) : (
          <ToolPlaceholder label={current.label} blurb={current.blurb} />
        )}
        <VerifyPanel />
      </main>
      <Footer />
    </div>
  )
}
