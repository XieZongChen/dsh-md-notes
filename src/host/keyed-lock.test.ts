import { describe, expect, it } from 'vitest'
import { createKeyedLock, createKeyedMutex } from './keyed-lock.ts'

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('createKeyedLock (reject-when-held)', () => {
  it('acquires, runs, and releases', async () => {
    const lock = createKeyedLock()
    const result = await lock.with('k', async () => 'v')
    expect(result).toEqual({ acquired: true, value: 'v' })
    expect(lock.isHeld('k')).toBe(false)
  })

  it('rejects a concurrent acquisition on the same key', async () => {
    const lock = createKeyedLock()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const first = lock.with('k', async () => { await gate; return 'first' })
    await tick() // let the first task acquire
    expect(lock.isHeld('k')).toBe(true)

    expect(await lock.with('k', async () => 'second')).toEqual({ acquired: false })
    release()
    expect(await first).toEqual({ acquired: true, value: 'first' })
  })
})

describe('createKeyedMutex (queue-when-held)', () => {
  it('serializes tasks under the same key (FIFO)', async () => {
    const mutex = createKeyedMutex()
    const order: string[] = []
    const a = mutex.runExclusive('k', async () => {
      order.push('a-start')
      await tick(20)
      order.push('a-end')
      return 'a'
    })
    const b = mutex.runExclusive('k', async () => { order.push('b-start'); return 'b' })
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toBe('a')
    expect(rb).toBe('b')
    expect(order).toEqual(['a-start', 'a-end', 'b-start'])
  })

  it('does not poison the queue when a task rejects', async () => {
    const mutex = createKeyedMutex()
    await expect(mutex.runExclusive('k', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await mutex.runExclusive('k', async () => 'ok')).toBe('ok')
  })

  it('runs different keys concurrently', async () => {
    const mutex = createKeyedMutex()
    let active = 0
    let maxActive = 0
    const task = (key: string): Promise<void> => mutex.runExclusive(key, async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await tick(10)
      active--
    })
    await Promise.all([task('a'), task('b'), task('c')])
    expect(maxActive).toBeGreaterThan(1)
  })
})
