import { useEffect, useState, useRef } from 'react'
import { FolderKanban, Check, Plus, Trash2, Edit3, ListTodo, X, Image as ImageIcon, FileText } from 'lucide-react'
import { useApp } from '../../store/AppContext'

type ProjectTask = { id: string, title: string, done: boolean }
type ProjectNote = { id: string, text: string, time: string }
type ProjectReminder = { id: string, time: string, note: string }
type ProjectDoc = { id: string, name: string, url: string, type: 'image' | 'video' | 'doc' }
type Priority = 'low' | 'medium' | 'high'

type Project = {
  id: string
  name: string
  icon: string
  progress: number
  priority: Priority
  description: string
  primaryImage?: string
  tasks: ProjectTask[]
  notes: ProjectNote[]
  reminders: ProjectReminder[]
  docs: ProjectDoc[]
  createdAt: string
}

const API = {
  save(p: Project[]) {
    localStorage.setItem('habitOS_projects', JSON.stringify(p))
  }
}

function migrateProject(p: any): Project {
  return {
    id: p.id || Date.now().toString(),
    name: p.name || 'Untitled',
    icon: p.icon || '🚀',
    progress: typeof p.progress === 'number'? p.progress : Math.round(((p.tasks||[]).filter((t:any)=>t.done).length / Math.max(1,(p.tasks||[]).length))*100),
    priority: (p.priority as Priority) || 'medium',
    description: p.description || 'Project description',
    primaryImage: p.primaryImage || '',
    tasks: p.tasks || [],
    notes: p.notes || [],
    reminders: p.reminders || [],
    docs: p.docs || [],
    createdAt: p.createdAt || new Date().toISOString()
  }
}

function InteractiveSineWaves() {
  const ref = useRef<HTMLCanvasElement>(null)
  const mouse = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let anim: number
    let t = 0
    const draw = () => {
      t += 0.02
      const w = canvas.width = canvas.offsetWidth * 2
      const h = canvas.height = canvas.offsetHeight * 2
      ctx.clearRect(0, 0, w, h)
      const waves = [
        { color: '#8b5cf6', amp: 18 + mouse.current.y * 0.05, freq: 0.015 + mouse.current.x * 0.00002, offset: 0 },
        { color: '#22d3ee', amp: 12 + mouse.current.y * 0.03, freq: 0.02, offset: 1.5 },
        { color: '#f97316', amp: 10, freq: 0.025, offset: 3 }
      ]
      waves.forEach(wv => {
        ctx.beginPath()
        ctx.strokeStyle = wv.color
        ctx.lineWidth = 2
        for (let x = 0; x < w; x++) {
          const y = h / 2 + Math.sin(x * wv.freq + t + wv.offset) * wv.amp + Math.sin(x * 0.008 + t) * 6
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      })
      anim = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(anim)
  }, [])
  return (
    <canvas
      ref={ref}
      className="w-full h-20 rounded-xl bg-[#0e0e12] border border-white/5"
      onMouseMove={e => {
        const rect = (e.target as any).getBoundingClientRect()
        mouse.current.x = e.clientX - rect.left
        mouse.current.y = e.clientY - rect.top
      }}
    />
  )
}

export default function ProjectsView() {
  const { setShowSkipConfirm, setSkipTarget } = useApp() as any

  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('habitOS_projects') || '[]')
      if (saved.length) return saved.map(migrateProject)
      return [
        {
          id: '1', name: 'HABIT.AI Mobile', icon: '📱', progress: 64, priority: 'high' as Priority,
          description: 'React Native mobile app.', primaryImage: '',
          tasks: [{ id: 't1', title: 'Tauri to React Native bridge', done: true }, { id: 't2', title: 'Sleep tracking API', done: true }, { id: 't3', title: 'Voice orb mobile gesture', done: false }],
          notes: [], reminders: [], docs: [], createdAt: new Date().toISOString()
        },
        {
          id: '2', name: 'Future Self OS', icon: '🧠', progress: 32, priority: 'medium' as Priority,
          description: 'Affirmations engine.', primaryImage: '',
          tasks: [{ id: 't4', title: 'Affirmations engine', done: true }, { id: 't5', title: 'Visualization renderer', done: false }],
          notes: [], reminders: [], docs: [], createdAt: new Date().toISOString()
        }
      ]
    } catch { return [] }
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = projects.find(p => p.id === selectedId) || null

  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectPriority, setNewProjectPriority] = useState<Priority>('medium')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newNote, setNewNote] = useState('')
  const [newReminderNote, setNewReminderNote] = useState('')
  const [newReminderTime, setNewReminderTime] = useState('09:00')
  const [editMode, setEditMode] = useState(false)
  const [editDesc, setEditDesc] = useState('')

  useEffect(() => { API.save(projects) }, [projects])

  const priorityOrder = { high: 0, medium: 1, low: 2 }
  const sortedProjects = [...projects].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  const addProject = () => {
    if (!newProjectName.trim()) return
    const p: Project = {
      id: Date.now().toString(),
      name: newProjectName.trim(),
      icon: '🚀',
      progress: 0,
      priority: newProjectPriority,
      description: 'New project description',
      primaryImage: '',
      tasks: [], notes: [], reminders: [], docs: [],
      createdAt: new Date().toISOString()
    }
    setProjects(prev => [...prev, p])
    setNewProjectName('')
  }

  const handlePrimaryImage = (e: any, projectId: string) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setProjects(prev => prev.map(p => p.id === projectId? {...p, primaryImage: url } : p))
  }

  const handleDocUpload = (e: any, projectId: string) => {
    const files = Array.from(e.target.files || []) as File[]
    files.forEach(f => {
      const url = URL.createObjectURL(f)
      const type = f.type.startsWith('image/')? 'image' : f.type.startsWith('video/')? 'video' : 'doc'
      const doc: ProjectDoc = { id: Date.now().toString() + Math.random(), name: f.name, url, type: type as any }
      setProjects(prev => prev.map(p => p.id === projectId? {...p, docs: [...(p.docs||[]), doc] } : p))
    })
  }

  return (
    <div className="p-4 md:p-6 space-y-4 bg-[#0f0f12] min-h-full">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white flex items-center gap-2"><FolderKanban className="w-5 h-5 text-violet-400" /> Projects • Progress + Deadline</h2>
        <button onClick={() => { setSkipTarget({ id: 'projects', name: 'Projects' }); setShowSkipConfirm(true) }} className="px-3 py-1.5 rounded-full bg-white/10 text-white/60 text-xs">Skip N days</button>
      </div>

      <div className="bg-[#141418] border border-white/10 rounded-xl p-4 space-y-3">
        <div className="text-xs tracking-widest text-white/40">PROJECT COMPLETION % ON TOP • SORTED BY PRIORITY</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {sortedProjects.map(p => (
            <div key={p.id} className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-white/40 truncate">{p.name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-md border ${p.priority==='high'? 'bg-red-500/20 border-red-500/20 text-red-300' : p.priority==='medium'? 'bg-amber-500/20 border-amber-500/20 text-amber-300' : 'bg-white/10 border-white/10 text-white/40'}`}>{p.priority}</span>
              </div>
              <div className="text-lg font-bold text-white mt-1">{p.progress?? 0}%</div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mt-2"><div className="h-full bg-gradient-to-r from-violet-500 to-blue-500" style={{ width: `${p.progress?? 0}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
          <div className="text-xs text-white/30 mb-2">LINEAR SINEWAVES • MULTIPLE • REACTS ON HOVER MOVE</div>
          <InteractiveSineWaves />
        </div>
      </div>

      <div className="rounded-xl bg-white/5 border border-white/10 p-3 flex gap-2">
        <input
          value={newProjectName}
          onChange={e => setNewProjectName(e.target.value)}
          onFocus={e => e.stopPropagation()}
          placeholder="Project name"
          type="text"
          autoComplete="off"
          className="flex-1 h-9 px-3 rounded-lg bg-[#0e0e12] border border-white/10 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-violet-500/30"
        />
        <select value={newProjectPriority} onChange={e => setNewProjectPriority(e.target.value as Priority)} className="h-9 px-3 rounded-lg bg-[#0e0e12] border border-white/10 text-xs text-white">
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button onClick={addProject} className="px-3 h-9 rounded-lg bg-white text-black text-xs font-semibold flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sortedProjects.map(p => {
          const docs = p.docs || []
          const tasks = p.tasks || []
          return (
            <div key={p.id} onClick={() => setSelectedId(p.id)} className="rounded-2xl bg-[#141418] border border-white/10 p-4 cursor-pointer hover:border-white/20 overflow-hidden">
              {p.primaryImage && <div className="h-24 rounded-xl overflow-hidden mb-3 border border-white/5"><img src={p.primaryImage} className="w-full h-full object-cover" /></div>}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-xs">{p.icon}</div><span className="text-sm font-medium text-white">{p.name}</span></div>
                <div className="flex items-center gap-2"><span className={`text-xs px-1.5 py-0.5 rounded-md ${p.priority==='high'? 'bg-red-500/20 text-red-300' : p.priority==='medium'? 'bg-amber-500/20 text-amber-300' : 'bg-white/10 text-white/40'}`}>{p.priority}</span><span className="text-xs text-white/40">{p.progress?? 0}%</span></div>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500" style={{ width: (p.progress?? 0) + '%' }} /></div>
              <div className="mt-3 space-y-1.5">
                {tasks.slice(0, 2).map((t: any) => (
                  <div key={t.id} className="flex items-center gap-2 text-xs text-white/60"><div className={t.done? 'w-4 h-4 rounded-full bg-white flex items-center justify-center' : 'w-4 h-4 rounded-full bg-white/10 border border-white/10'}>{t.done && <Check className="w-2.5 h-2.5 text-black" />}</div>{t.title}</div>
                ))}
                {docs.length>0 && <div className="text-xs text-white/20 flex items-center gap-1 mt-2"><FileText className="w-3 h-3" /> {docs.length} files</div>}
              </div>
            </div>
          )
        })}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur flex justify-center p-4 overflow-y-auto">
          <div className="bg-[#141418] border border-white/10 rounded-2xl w-full max-w-6xl min-h-0 grid grid-cols-1 md:grid-cols-3 overflow-hidden">
            <div className="md:col-span-2 p-5 space-y-4 border-r border-white/5 overflow-y-auto max-h-[70vh]">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center">{selected.icon}</div><div><div className="text-base font-semibold text-white flex items-center gap-2">{selected.name} <span className={`text-xs px-2 py-0.5 rounded-full ${selected.priority==='high'? 'bg-red-500/20 text-red-300' : selected.priority==='medium'? 'bg-amber-500/20 text-amber-300' : 'bg-white/10 text-white/40'}`}>{selected.priority}</span></div><div className="text-xs text-white/30">{selected.progress?? 0}% • {(selected.tasks||[]).filter(t => t.done).length}/{(selected.tasks||[]).length} tasks</div></div></div>
                <button onClick={() => setSelectedId(null)} className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center"><X className="w-4 h-4 text-white/40" /></button>
              </div>

              <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
                <div className="text-xs text-white/30 mb-2">PRIMARY TITLE IMAGE</div>
                <div className="flex gap-2 items-center">
                  {selected.primaryImage? <img src={selected.primaryImage} className="w-24 h-16 rounded-xl object-cover border border-white/10" /> : <div className="w-24 h-16 rounded-xl bg-[#141418] border border-white/10 flex items-center justify-center"><ImageIcon className="w-5 h-5 text-white/20" /></div>}
                  <label className="px-3 py-2 rounded-xl bg-white text-black text-xs font-semibold cursor-pointer"><input type="file" accept="image/*" className="hidden" onChange={e => handlePrimaryImage(e, selected.id)} /> Upload primary</label>
                  <select value={selected.priority} onChange={e => setProjects(prev => prev.map(p => p.id===selected.id? {...p, priority: e.target.value as Priority} : p))} className="px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
                </div>
              </div>

              <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
                <div className="text-xs text-white/30 mb-2">DOCUMENTS • IMAGES • VIDEOS</div>
                <label className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-white text-xs flex items-center gap-1 cursor-pointer w-fit"><ImageIcon className="w-3 h-3" /> Add files<input type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx" className="hidden" onChange={e => handleDocUpload(e, selected.id)} /></label>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {(selected.docs||[]).map(d => (
                    <div key={d.id} className="p-2 rounded-xl bg-[#141418] border border-white/5">
                      {d.type==='image'? <img src={d.url} className="w-full h-20 object-cover rounded-lg mb-1" /> : d.type==='video'? <video src={d.url} controls className="w-full h-20 rounded-lg mb-1" /> : <div className="h-20 rounded-lg bg-white/5 flex items-center justify-center"><FileText className="w-6 h-6 text-white/30" /></div>}
                      <div className="text-xs text-white/40 truncate">{d.name}</div>
                      <button onClick={() => setProjects(prev => prev.map(p => p.id===selected.id? {...p, docs: (p.docs||[]).filter(x=>x.id!==d.id)} : p))} className="text-xs text-red-300">Delete</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-3"><ListTodo className="w-4 h-4 text-violet-400" /><div className="text-xs tracking-widest text-white/40">TASKS</div></div>
                <div className="flex gap-2 mb-3">
                  <input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} onFocus={e => e.stopPropagation()} placeholder="Add task..." type="text" autoComplete="off" className="flex-1 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white placeholder:text-white/20 focus:outline-none" />
                  <button onClick={() => {
                    if (!newTaskTitle.trim() ||!selectedId) return
                    setProjects(prev => prev.map(p => {
                      if (p.id!== selectedId) return p
                      const newTasks = [...(p.tasks||[]), { id: Date.now().toString(), title: newTaskTitle.trim(), done: false }]
                      return {...p, tasks: newTasks, progress: Math.round((newTasks.filter(t => t.done).length / newTasks.length) * 100) }
                    }))
                    setNewTaskTitle('')
                  }} className="px-3 py-2 rounded-xl bg-white text-black text-xs font-semibold">Add</button>
                </div>
                <div className="space-y-2">{(selected.tasks||[]).map(t => (
                  <div key={t.id} className="flex items-center gap-2 p-2 rounded-xl bg-[#141418] border border-white/5"><button onClick={() => setProjects(prev => prev.map(p => p.id===selectedId? {...p, tasks: (p.tasks||[]).map(x=> x.id===t.id? {...x, done:!x.done} : x), progress: Math.round(((p.tasks||[]).map(x=> x.id===t.id? {...x, done:!x.done} : x).filter(x=>x.done).length / Math.max(1,(p.tasks||[]).length))*100)} : p))} className={`${t.done? 'bg-white' : 'border-white/20'} w-5 h-5 rounded-full border flex items-center justify-center`}><Check className={`${t.done? 'text-black' : 'text-transparent'} w-3 h-3`} /></button><span className={`${t.done? 'line-through text-white/30' : 'text-white/70'} text-sm flex-1`}>{t.title}</span><button onClick={() => setProjects(prev => prev.map(p => p.id===selectedId? {...p, tasks: (p.tasks||[]).filter(x=>x.id!==t.id), progress: Math.round(((p.tasks||[]).filter(x=>x.id!==t.id && x.done).length / Math.max(1,(p.tasks||[]).filter(x=>x.id!==t.id).length))*100)} : p))} className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center"><Trash2 className="w-3 h-3 text-white/30" /></button></div>
                ))}</div>
              </div>

              <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
                <div className="text-xs text-white/30 mb-2">NOTES + REMINDERS</div>
                <div className="flex gap-2 mb-2"><input value={newNote} onChange={e => setNewNote(e.target.value)} onFocus={e => e.stopPropagation()} placeholder="Note..." type="text" autoComplete="off" className="flex-1 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white" /><button onClick={() => { if(!newNote.trim()) return; setProjects(prev=> prev.map(p=> p.id===selectedId? {...p, notes:[...(p.notes||[]), {id:Date.now().toString(), text:newNote, time:new Date().toLocaleTimeString()}]}:p)); setNewNote('') }} className="px-3 py-2 rounded-xl bg-white/10 text-white text-xs">Add note</button></div>
                <div className="flex gap-2"><input type="time" value={newReminderTime} onChange={e=>setNewReminderTime(e.target.value)} className="px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white" /><input value={newReminderNote} onChange={e=>setNewReminderNote(e.target.value)} onFocus={e=>e.stopPropagation()} placeholder="Reminder..." type="text" autoComplete="off" className="flex-1 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white" /><button onClick={() => { if(!newReminderNote.trim()) return; setProjects(prev=> prev.map(p=> p.id===selectedId? {...p, reminders:[...(p.reminders||[]), {id:Date.now().toString(), time:newReminderTime, note:newReminderNote}]}:p)); setNewReminderNote('') }} className="px-3 py-2 rounded-xl bg-white/10 text-white text-xs">Add</button></div>
              </div>
            </div>

            <div className="p-5 space-y-4 bg-[#0f0f12]">
              <div className="flex items-center justify-between"><div className="text-xs tracking-widest text-white/40">PROJECT DESCRIPTION</div><button onClick={() => { setEditMode(!editMode); if(selected) setEditDesc(selected.description) }} className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center"><Edit3 className="w-3 h-3 text-white/30" /></button></div>
              {!editMode? <div className="text-sm text-white/60 leading-relaxed">{selected.description}</div> : (
                <div className="space-y-2">
                  <textarea value={editDesc} onChange={e=>setEditDesc(e.target.value)} onFocus={e=>e.stopPropagation()} className="w-full h-32 p-3 rounded-xl bg-[#141418] border border-white/10 text-sm text-white focus:outline-none" />
                  <div className="flex gap-2"><button onClick={() => { setProjects(prev=> prev.map(p=> p.id===selected.id? {...p, description:editDesc}:p)); setEditMode(false) }} className="px-3 py-2 rounded-xl bg-white text-black text-xs font-semibold">Save</button><button onClick={()=>setEditMode(false)} className="px-3 py-2 rounded-xl bg-white/10 text-white/40 text-xs">Cancel</button></div>
                </div>
              )}
              <div className="bg-[#141418] border border-white/5 rounded-xl p-3">
                <div className="text-xs text-white/30 mb-2">COMPLETION</div>
                <div className="text-2xl font-bold text-white">{selected.progress?? 0}%</div>
                <InteractiveSineWaves />
              </div>
              <button onClick={() => { if(confirm('Delete project?')) { setProjects(prev=> prev.filter(p=> p.id!==selected.id)); setSelectedId(null) } }} className="w-full py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs">Delete project</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}