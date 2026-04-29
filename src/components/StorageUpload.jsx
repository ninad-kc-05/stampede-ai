import { Upload } from 'lucide-react'

function StorageUpload({ onUpload, disabled = false, label = 'Upload Demo Video' }) {
  return (
    <label
      className={`inline-flex items-center gap-2 rounded-lg border border-[#1a3a1a] bg-[#0d140d] px-4 py-2 text-sm font-semibold text-[#00cc33] hover:bg-[#111a11] ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      }`}
    >
      <Upload className="h-4 w-4" />
      {label}
      <input type="file" accept="video/*" className="hidden" onChange={onUpload} disabled={disabled} />
    </label>
  )
}

export default StorageUpload
