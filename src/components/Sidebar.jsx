import {
  AlertOctagon,
  BarChart3,
  Bug,
  ChevronLeft,
  ChevronRight,
  Home,
  MonitorPlay,
  Radio,
  Video,
} from 'lucide-react'

const modules = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'monitoring', label: 'Live Monitoring', icon: MonitorPlay },
  { id: 'debug', label: 'Debug', icon: Bug },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'emergency', label: 'Emergency', icon: AlertOctagon },
  { id: 'recording', label: 'Recording', icon: Video },
]

function Sidebar({ activeModule, onChange, collapsed, onToggle }) {
  return (
    <aside
      className={`flex h-full flex-col border-r border-[#1a3a1a] bg-[#0b100b] px-3 py-4 shadow-sm transition-all duration-300 ${
        collapsed ? 'w-[84px]' : 'w-[248px]'
      }`}
    >
      <div className="mb-4 flex items-center justify-between px-1">
        {!collapsed ? (
          <div>
            <p className="text-lg font-semibold phosphor-text">Stampede AI</p>
            <p className="text-xs uppercase tracking-wide text-[#004d14]">Tactical System</p>
          </div>
        ) : (
          <div className="mx-auto rounded-xl border border-[#1a3a1a] bg-[#0d140d] p-2">
            <Radio className="h-5 w-5 text-[#00ff41]" />
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-1.5 text-[#00cc33] hover:bg-[#111a11]"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="space-y-1">
        {modules.map((item) => {
          const Icon = item.icon
          const active = activeModule === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? 'bg-[#ff3333]/10 text-[#ff3333] ring-1 ring-[#ff3333]/40'
                  : 'text-[#00cc33] hover:bg-[#00ff41]/5'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <Icon className={`h-4 w-4 ${active ? 'text-[#ff3333]' : 'text-[#00cc33]'}`} />
              {!collapsed ? <span>{item.label}</span> : null}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}

export default Sidebar
