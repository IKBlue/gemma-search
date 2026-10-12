// useToast —— 轻提示状态（消息 + 语气 + 自动消失）
import { useCallback, useEffect, useRef, useState } from 'react'

export default function useToast(ms = 2600) {
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState('info')          // info | err
  const timer = useRef(null)

  const show = useCallback((msg, t = 'info') => {
    setMessage(String(msg))
    setTone(t)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(''), ms)
  }, [ms])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return { message, tone, show }
}
