import { useCallback, useEffect } from 'react'
import { useApp } from './store/AppContext'
import TitleBar from './components/layout/TitleBar'
import VoiceCommandBar from './components/layout/VoiceCommandBar'
import Sidebar, { MobileTabs } from './components/layout/Sidebar'
import RightPanel from './components/layout/RightPanel'
import AlarmOverlay from './components/layout/AlarmOverlay'
import Onboarding from './components/layout/Onboarding'
import SkipConfirmModal from './components/modals/SkipConfirmModal'
import WorkoutPopup from './components/modals/WorkoutPopup'
import TodayView from './features/today/TodayView'
import SettingsView from './features/settings/SettingsView'
import WaterView from './features/water/WaterView'
import WorkoutView from './features/workout/WorkoutView'
import TasksView from './features/tasks/TasksView'
import ProjectsView from './features/projects/ProjectsView'
import RitualsView from './features/rituals/RitualsView'
import SleepView from './features/sleep/SleepView'
import AnalyticsView from './features/analytics/AnalyticsView'
import { speakingModel } from './speaking/speakingModel'
import { personality } from './speaking/personality'
import { playlist } from './core/playlist'

const VIEWS: Record<string, any> = {
  Today: TodayView,
  Water: WaterView,
  Workout: WorkoutView,
  Tasks: TasksView,
  Projects: ProjectsView,
  Rituals: RitualsView,
  Sleep: SleepView,
  Analytics: AnalyticsView,
  Settings: SettingsView
}

export default function App() {
  const app = useApp() as any
  const {
    activeTab, runCommand, isListening, setIsListening, onboarded,
    showWorkoutPopup, setShowWorkoutPopup, setWorkoutPopupTask, workoutPopupTask, enableMic, tapToTalk, playingPlaylist
  } = app

  const startHold = useCallback(() => {
    const go = () => tapToTalk(
      (text: string) => { if (text) runCommand(text) },
      (live: boolean) => setIsListening(live)
    )
    if (app.micPermission !== 'granted') {
      enableMic().then((ok: boolean) => {
        if (ok) go()
        else app.setAssistantResponse('Microphone is blocked — allow it in Settings • Voice so I can hear you.')
      })
      return
    }
    go()
  }, [app, enableMic, runCommand, setIsListening, tapToTalk])

  const speakTest = (t?: string) => {
    speakingModel.speak(t || `Good morning ${personality.getUserName() || 'there'} — this is ${app.aiName || 'Habi'}, your voice OS is online.`)
  }
  const stopSpeak = () => speakingModel.stop()

  const View = VIEWS[activeTab] || TodayView

  useEffect(() => {
    // Esc closes whatever full-screen layer is on top: ritual stage, playlist keeps playing.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && app.ritualFullscreen) app.setRitualFullscreen(false)
      if (e.key === ' ' && e.target === document.body) { e.preventDefault(); startHold() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app.ritualFullscreen, startHold])

  return (
    <div className="h-full min-h-screen w-screen flex flex-col bg-[#0f0f12] overflow-hidden">
      <TitleBar />
      <VoiceCommandBar
        onCommand={(t: string) => runCommand(t)}
        onTriggerWorkout={() => setShowWorkoutPopup(true)}
        onMic={startHold}
        listening={isListening}
        assistant={app.assistantResponse}
        aiName={app.aiName}
      />
      <MobileTabs />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <div className="flex-1 min-w-0 overflow-auto">
          <View
            onCommand={(t: string) => runCommand(t)}
            onTriggerWorkout={() => setShowWorkoutPopup(true)}
            speakTest={speakTest}
            stopSpeak={stopSpeak}
            openWorkout={(task: any) => { setWorkoutPopupTask(task); setShowWorkoutPopup(true) }}
          />
        </div>
        <aside className="hidden xl:flex w-[300px] shrink-0 border-l border-white/10 bg-[#0c0c0e]">
          <RightPanel />
        </aside>
      </div>

      {/* now playing strip: replaces the floating orb, which is gone */}
      {playingPlaylist && (
        <div className="shrink-0 h-9 bg-[#0c0c0e] border-t border-white/[0.06] flex items-center gap-3 px-3 text-[11px] text-white/50">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="truncate max-w-[45%]">Morning playlist • {(app.playlistTracks || []).length} tracks • say “next track” or “stop music”</span>
          <button onClick={() => playlist.prev()} className="px-2 py-0.5 rounded-full bg-white/5">‹</button>
          <button onClick={() => playlist.pause()} className="px-2 py-0.5 rounded-full bg-white/10 text-white/70">pause</button>
          <button onClick={() => playlist.next()} className="px-2 py-0.5 rounded-full bg-white/5">›</button>
          <span className="ml-auto text-white/25 capitalize">mode: {app.playlistMode}</span>
        </div>
      )}

      {showWorkoutPopup && <WorkoutPopup onClose={() => setShowWorkoutPopup(false)} task={workoutPopupTask} />}
      <SkipConfirmModal />
      <AlarmOverlay />
      {!onboarded && <Onboarding />}
    </div>
  )
}
