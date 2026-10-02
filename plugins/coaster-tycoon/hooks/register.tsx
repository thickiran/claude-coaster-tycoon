import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Leaderboard, ParkBoard, ParkView } from '../types'
import { BOARD_URL, GIST_FILE, REPO, ago, cleanName, pad, parkId, parkStats } from './board'
import type { ParkStats } from './board'
import { renderFrame, toRasterCells, toSvg } from './draw'
import { renderSvg } from './vector'
import {
  buildingRides, createWorld, loadWorld, parkRating, ratingLabel, saveWorld, step,
  toolCalled, toolFailed, turnEnded, turnStarted,
} from './sim'
import type { World } from './sim'

const PANE = 'coaster-park'
const DT = 0.15
const PUSH_MS = 10 * 60 * 1000
const FETCH_MS = 5 * 60 * 1000
const tick = atom({ plugin: 'coaster-tycoon', key: 'tick' } as const, 0)
const view = atom({ plugin: 'coaster-tycoon', key: 'view' } as const, 'park' as ParkView)
const board = atom({ plugin: 'coaster-tycoon', key: 'board' } as const, { board: null, fetchedAt: 0, error: '' } as ParkBoard)

type Account = { user: string; gist: string }

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
let world: World | undefined
let isBusy = false
let frames = 0
let lastStatus = ''
let myRank = 0
// The model each loop last stepped with: 'main', or a subagent's id.
const models = new Map<string, string>()

// One park per project: the git repository's root when there is one (so its
// subfolders share a park), else the folder the session started in.
let parkKey = ''
let parkName = 'Claude Park'
let myParkId = ''

async function project($: EngineInterface): Promise<string> {
  if (parkKey) return parkKey
  const cwd = await $.session.cwd()
  let root = cwd
  try {
    const git = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 3000 })
    const top = git.stdout.trim()
    if (git.exitCode === 0 && top) root = top
  } catch {
    // Not a repository, or no git: the folder itself is the project.
  }
  parkKey = `park:${root}`
  myParkId = await parkId(root)
  const base = root.split('/').filter(Boolean).pop() ?? 'Claude'
  parkName = `${base} Park`

  return parkKey
}

async function park($: EngineInterface): Promise<World> {
  if (!world) {
    const key = await project($)
    let saved = await $.store.get(key)
    if (!saved) {
      // The park from before parks were per project moves into this one.
      saved = await $.store.get('park')
      if (saved) await $.store.delete('park')
    }
    world = saved ? loadWorld(saved) : createWorld()
  }

  return world
}

function displayName(w: World): string {
  return w.shareName || parkName
}

async function save($: EngineInterface) {
  if (!world) return
  world.isDirty = false
  await $.store.set(await project($), saveWorld(world))
}

async function resetPark($: EngineInterface) {
  const was = world
  world = createWorld()
  if (was) {
    world.isShared = was.isShared
    world.shareName = was.shareName
  }
  await save($)
}

async function frame($: EngineInterface) {
  if (isBusy || !world) return
  isBusy = true
  try {
    step(world, DT)
    frames += 1
    for (const text of world.toasts.splice(0)) $.ui.toast(text, { timeoutMs: 6000 })
    if (frames % 14 === 0) {
      const open = world.rides.filter(r => r.status === 'open').length
      const rank = myRank > 0 && world.isShared ? `🏆 #${myRank} · ` : ''
      const status = `${rank}🎢 ${open} ride${open === 1 ? '' : 's'} · 👥 ${world.guests.length} · ${money(world.money)}`
      if (status !== lastStatus) {
        lastStatus = status
        $.ui.status(status)
      }
    }
    if ((world.isDirty && frames % 20 === 0) || frames % 200 === 0) await save($)
    await update($, tick, n => (n + 1) % 1_000_000)
  } finally {
    isBusy = false
  }
}

// ---- The global leaderboard ---------------------------------------------
// A joined park lives in a public gist of the player's own (through their
// `gh` login); the repository's Action reads every registered gist and
// publishes the ranking, which the pane fetches.

async function gh($: EngineInterface, args: string[], stdin?: string) {
  return $.process.run(['gh', ...args], { stdin, timeoutMs: 20_000 })
}

async function account($: EngineInterface): Promise<Account | undefined> {
  const saved = (await $.store.get('account')) as Account | undefined

  return saved && typeof saved.user === 'string' && typeof saved.gist === 'string' ? saved : undefined
}

async function readGist($: EngineInterface, gist: string): Promise<Record<string, ParkStats>> {
  const got = await gh($, ['api', `gists/${gist}`, '--jq', `.files["${GIST_FILE}"].content`])
  if (got.exitCode !== 0) throw new Error(got.stderr.trim() || 'could not read the park gist')
  try {
    const parsed = JSON.parse(got.stdout || '{}') as { parks?: Record<string, ParkStats> }
    return parsed.parks ?? {}
  } catch {
    return {}
  }
}

async function writeGist($: EngineInterface, gist: string, parks: Record<string, ParkStats>) {
  const content = JSON.stringify({ v: 1, parks }, null, 2)
  const sent = await gh($, ['api', '-X', 'PATCH', `gists/${gist}`, '--input', '-'], JSON.stringify({ files: { [GIST_FILE]: { content } } }))
  if (sent.exitCode !== 0) throw new Error(sent.stderr.trim() || 'could not update the park gist')
}

async function pushPark($: EngineInterface) {
  const w = await park($)
  const acct = await account($)
  if (!w.isShared || !acct) return
  try {
    const parks = await readGist($, acct.gist)
    parks[myParkId] = parkStats(w, myParkId, displayName(w))
    await writeGist($, acct.gist, parks)
  } catch {
    // Offline or gh signed out: the next period tries again.
  }
}

async function fetchBoard($: EngineInterface) {
  try {
    const got = await $.http.fetch(`${BOARD_URL}?t=${Math.floor(Date.now() / 60_000)}`)
    if (!got.ok) throw new Error(`HTTP ${got.status}`)
    const parsed = JSON.parse(got.text) as Leaderboard
    const acct = await account($)
    const mine = acct ? parsed.entries.find(x => x.user === acct.user && x.id === myParkId) : undefined
    myRank = mine?.rank ?? 0
    await update($, board, () => ({ board: parsed, fetchedAt: Date.now(), error: '' }))
  } catch (err) {
    await update($, board, b => ({ ...b, fetchedAt: Date.now(), error: err instanceof Error ? err.message : 'could not fetch' }))
  }
}

async function join($: EngineInterface, name: string): Promise<string> {
  const w = await park($)
  if (name) w.shareName = cleanName(name)
  const me = await gh($, ['api', 'user', '--jq', '.login']).catch(() => undefined)
  if (!me || me.exitCode !== 0 || !me.stdout.trim()) {
    return 'Joining needs the GitHub CLI, signed in: install `gh` from https://cli.github.com and run `gh auth login`, then `/park join` again.'
  }
  const user = me.stdout.trim()
  let acct = await account($)
  const stats = parkStats(w, myParkId, displayName(w))
  if (!acct || acct.user !== user) {
    const made = await gh(
      $,
      ['gist', 'create', '--public', '--filename', GIST_FILE, '--desc', 'My Claude Code Coaster Tycoon parks (github.com/thickiran/claude-coaster-tycoon)', '-'],
      JSON.stringify({ v: 1, parks: { [myParkId]: stats } }, null, 2),
    )
    const url = made.stdout.trim().split('\n').pop() ?? ''
    const gist = url.split('/').pop() ?? ''
    if (made.exitCode !== 0 || !/^[0-9a-f]{20,40}$/.test(gist)) {
      return `Could not create your park gist: ${made.stderr.trim() || 'unknown error'}`
    }
    const filed = await gh($, [
      'issue', 'create', '--repo', REPO, '--title', `[park] join: ${user}`,
      '--body', `Registering my park gist for the global leaderboard.\n\n\`\`\`json\n${JSON.stringify({ gist })}\n\`\`\``,
    ])
    if (filed.exitCode !== 0) return `Your park gist is up, but registering it failed: ${filed.stderr.trim()}`
    acct = { user, gist }
    await $.store.set('account', acct)
  }
  w.isShared = true
  w.isDirty = true
  await save($)
  await pushPark($)

  return `🏆 ${displayName(w)} joined the global leaderboard as ${user}. Scores update every 10 minutes, and the board refreshes about every 20. Open it with the Leaderboard button or \`/park top\`. Only game stats and the park's name are shared; \`/park leave\` takes it off.`
}

async function leave($: EngineInterface): Promise<string> {
  const w = await park($)
  const acct = await account($)
  w.isShared = false
  await save($)
  if (acct) {
    try {
      const parks = await readGist($, acct.gist)
      delete parks[myParkId]
      await writeGist($, acct.gist, parks)
    } catch {
      return `${displayName(w)} stopped sharing, but its last stats could not be removed from your gist just now.`
    }
  }
  myRank = 0

  return `${displayName(w)} is off the leaderboard. It drops out at the board's next update.`
}

async function showBoard($: EngineInterface) {
  await update($, view, () => 'leaderboard')
  const b = await read($, board)
  if (Date.now() - b.fetchedAt > 60_000) await fetchBoard($)
}

const USAGE = '`/park` opens it · `/park top` leaderboard · `/park join [name]` · `/park name <name>` · `/park leave` · `/park reset`'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await park($)
    await $.command.register({
      name: 'park',
      description: 'Your Coaster Tycoon park: top, join, leave, name, reset',
      argumentHint: '[top | join [name] | leave | name <name> | reset]',
      immediate: true,
    })
    $.clock.every(DT * 1000, () => void frame($))
    $.clock.every(PUSH_MS, () => void pushPark($))
    $.clock.every(FETCH_MS, () => void fetchBoard($))
    void fetchBoard($)
    void $.ui.open({ id: PANE, title: parkName, rows: 26 })

    return next(e)
  })

  on('command.run', { command: 'park' }, async ($, e) => {
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')
    const w = await park($)
    const openPane = () => $.ui.open({ id: PANE, title: parkName, rows: 26, focus: true })
    switch (sub) {
      case 'reset':
        await resetPark($)
        await openPane()
        return { text: `${displayName(w)} was bulldozed. Fresh grass, $10,000, and hungry construction crews.` }
      case 'join':
        return { text: await join($, arg) }
      case 'leave':
        return { text: await leave($) }
      case 'name':
        if (!arg) return { text: `This park is called ${displayName(w)}. Rename it with \`/park name <name>\`.` }
        w.shareName = cleanName(arg)
        await save($)
        await pushPark($)
        return { text: `Renamed to ${w.shareName}.` }
      case 'top':
      case 'leaderboard':
        await openPane()
        await showBoard($)
        return { text: 'Opened the global leaderboard.' }
      case '':
        await update($, view, () => 'park')
        await openPane()
        return { text: `Welcome to ${displayName(w)}. ${USAGE}` }
      default:
        return { text: USAGE }
    }
  })

  on('turn.start', async ($, e, next) => {
    turnStarted(await park($))

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    models.set(e.agentId ?? 'main', e.model)

    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    const w = await park($)
    const model = models.get(e.agentId ?? 'main') ?? models.get('main') ?? 'opus'
    const rideName = toolCalled(w, e.tool, model)
    const ran = await next(e)
    if (rideName && ran.deny === undefined && ran.isError === true) toolFailed(w, rideName)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    turnEnded(await park($), e.reason)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await save($)
    await pushPark($)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, tick)
    const w = await park($)
    const showing = await read($, view)
    const els = $.ui.resolve(e) as Record<string, (props: object) => unknown>
    const Box = els.Box as any
    const Text = els.Text as any
    const Button = els.Button as any
    const open = w.rides.filter(r => r.status === 'open')

    if (showing === 'leaderboard') {
      const b = await read($, board)
      const acct = await account($)
      const cols: [string, number, boolean][] = [['#', 4, true], ['Player', 16, false], ['Park', 22, false], ['Score', 7, true], ['⭐', 5, true], ['Guests', 7, true], ['Rides', 6, true], ['Updated', 10, true]]
      const row = (cells: (string | number)[], isMine: boolean, isHead = false) => (
        <Box flexDirection="row">
          {cells.map((c, i) => (
            <Box width={cols[i]![1] + 1}>
              <Text bold={isHead || isMine} dimColor={isHead} color={isMine ? '#f0d020' : undefined} wrap="truncate">
                {pad(c, cols[i]![1], cols[i]![2])}
              </Text>
            </Box>
          ))}
        </Box>
      )
      const entries = b.board?.entries.slice(0, 20) ?? []

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>🏆 Global leaderboard{b.board ? ` · ${b.board.players} players · updated ${ago(b.board.updatedAt, Date.now())}` : ''}</Text>
            <Box flexDirection="row" gap={1}>
              <Button key="refresh" label="Refresh" onPress={() => fetchBoard($)} />
              <Button key="to-park" label="Back to park" variant="primary" onPress={() => update($, view, () => 'park')} />
            </Box>
          </Box>
          {row(cols.map(c => c[0]), false, true)}
          {entries.map(x => row(
            [x.rank, x.user, x.name, x.score.toLocaleString('en-US'), x.rating, x.guestsTotal.toLocaleString('en-US'), x.ridesOpen, ago(x.updatedAt, Date.now())],
            acct?.user === x.user && x.id === myParkId,
          ))}
          {entries.length === 0 && <Text dimColor>{b.error ? `Could not load the board: ${b.error}` : b.board ? 'No parks yet. Be the first: /park join' : 'Loading...'}</Text>}
          <Text dimColor>
            {w.isShared
              ? `You're playing as ${acct?.user ?? '?'} with ${displayName(w)}${myRank ? `, rank #${myRank}` : ', waiting for the next board update'}.`
              : 'This park is not on the board. Type /park join [name] to enter it. Only game stats and the park name are shared.'}
          </Text>
        </Box>
      )
    }

    const crews = buildingRides(w)
    const testing = w.rides.filter(r => r.status === 'testing')
    const hasNews = w.time - w.newsAt < 7 || !w.thought
    const ticker = hasNews ? `📰 ${w.news}` : `💭 ${w.thought}`
    const jobs = [
      ...testing.map(r => `🧪 Testing ${r.name}`),
      ...crews.map(r => `🚧 ${r.builtBy} crew: ${r.name} (${r.kind}) ${Math.min(r.built, r.size)}/${r.size}${w.isWorking ? '' : ', finishing up'}`),
    ]
    const job = jobs.length > 0
      ? jobs.join('  ·  ')
      : w.isWorking ? '🚧 Crews standing by for the next ride' : '🌳 Crews on break. Give Claude work to build more rides.'
    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{displayName(w)}</Text>
        <Text bold color="#f0d020">{money(w.money)}</Text>
        <Text>👥 {w.guests.length} in park ({w.guestsTotal} total)</Text>
        <Text>⭐ {parkRating(w)}</Text>
        <Text>🎢 {open.length} open</Text>
        <Button key="to-board" label={myRank && w.isShared ? `🏆 #${myRank}` : '🏆 Leaderboard'} onPress={() => showBoard($)} />
      </Box>
    )

    if (e.surface === 'terminal') {
      const Raster = els.Raster as any
      const cols = Math.max(24, Math.min(512, e.props.bodyColumns))
      const rows = Math.max(8, Math.min(120, e.props.scroll.bodyRows - 4))
      const px = renderFrame(w, cols, rows * 2, 4)

      return (
        <Box flexDirection="column">
          {header}
          <Raster key="park" columns={cols} rows={rows} cells={toRasterCells(px, cols, rows)} />
          <Text wrap="truncate">{job}</Text>
          <Text wrap="truncate" dimColor>{ticker}</Text>
        </Box>
      )
    }

    const Svg = els.Svg as any
    const W = 220
    const H = 150
    let svg = renderSvg(w)
    if (svg.length > 130_000) svg = toSvg(renderFrame(w, W, H), W, H, 4)
    if (svg.length > 130_000) svg = toSvg(renderFrame(w, 160, 110), 160, 110, 5.5)
    const best = [...w.rides].sort((a, b) => b.excitement - a.excitement)

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        <Svg source={svg} alt={`${displayName(w)}: ${open.length} rides open, ${w.guests.length} guests`} />
        <Text>{job}</Text>
        <Text dimColor>{ticker}</Text>
        {best.length > 0 && (
          <Box flexDirection="column">
            {best.map(r => (
              <Text wrap="truncate">
                <Text bold>{r.name}</Text>
                <Text dimColor> {r.tier === 'big' ? '🎢' : r.tier === 'medium' ? '🎠' : '🎡'} {r.kind} by {r.builtBy} · </Text>
                {r.status === 'open'
                  ? `E ${r.excitement.toFixed(2)} (${ratingLabel(r.excitement)}) · I ${r.intensity.toFixed(2)} · N ${r.nausea.toFixed(2)} · $${r.price} · ${r.riders} riders`
                  : r.status === 'crashed' ? '💥 crashed, awaiting repairs' : r.status === 'testing' ? '🧪 testing' : '🚧 under construction'}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
