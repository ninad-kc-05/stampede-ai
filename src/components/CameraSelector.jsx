import { MapPin, Crosshair } from 'lucide-react'
import { zones } from '../data/simulation'

function CameraSelector({ zone, onZoneChange }) {
  return (
    <div className="flex items-center gap-3">
      <Crosshair className="h-4 w-4 text-[#00ff41]" />
      <label className="flex items-center gap-2 text-xs text-[#00cc33]">
        <span className="text-[#004d14]">SECTOR:</span>
        <select
          value={zone}
          onChange={(event) => onZoneChange(event.target.value)}
          className="rounded-sm border border-[#1a3a1a] bg-[#0d140d] px-3 py-1.5 text-xs text-[#00ff41] outline-none transition hover:border-[#00ff41] focus:border-[#00ff41] font-mono"
        >
          {zones.map((zoneOption) => (
            <option key={zoneOption} value={zoneOption} className="bg-[#0d140d] text-[#00ff41]">
              {zoneOption}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

export default CameraSelector
