import { useParams } from 'react-router-dom'

export default function SurveyDonePage() {
  const { token } = useParams<{ token: string }>()
  void token

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">ขอบคุณสำหรับการตอบแบบประเมิน</h1>
        <p className="text-sm text-gray-500 mb-1">ส่งแบบประเมินเรียบร้อยแล้ว</p>
        <p className="text-xs text-gray-400">
          เวลาที่ส่ง:{' '}
          {new Date().toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' })}
        </p>
        <div className="mt-6 pt-5 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            หากมีข้อสงสัยกรุณาติดต่อ ฝ่าย Technical Operation Division
          </p>
          <p className="text-xs text-gray-400 mt-1">
            IT Survey System — ISO 9001:2015 | ISO/IEC 27001:2022
          </p>
        </div>
      </div>
    </div>
  )
}
