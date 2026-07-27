// Survey sub-navigation now lives in the main app Sidebar (submenu under
// "Survey ISO"), so this layout is just a full-width scroll container.
export default function SurveyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      {children}
    </div>
  )
}
