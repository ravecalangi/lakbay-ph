const OWM_KEY         = 'ba05f075a467545f163ff074d8922d0c'
const OTM_KEY         = '5ae2e3f221c38a28845f05b60e31417081b681cb2a2f86ff2e51bc1c'
const OPENROUTER_KEY  = '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'
const OPENROUTER_MODEL = 'openai/gpt-3.5-turbo'

const OTM_BASE = 'https://api.opentripmap.com/0.1/en/places'
const OWM_BASE = 'https://api.openweathermap.org/data/2.5'

let isDark = false
let currentCity = ''
let allPlaces = []
let placePage = 0
const PAGE_SIZE = 15
let selectedKind = 'interesting_places'
let tempChart = null, rainChart = null, windChart = null
let currentWeatherData = null, currentForecastData = null, currentAqiData = null
let chatOpen = false

const html          = document.documentElement
const overlay       = document.getElementById('loading-overlay')
const content       = document.getElementById('content')
const errToast      = document.getElementById('error-toast')
const searchForm    = document.getElementById('search-form')
const searchInp     = document.getElementById('search-input')
const searchBtn     = document.getElementById('search-btn')
const chatPanel     = document.getElementById('chat-panel')
const chatToggleBtn = document.getElementById('chat-toggle-btn')

function openSettings()  { document.getElementById('settings-overlay').classList.add('open') }
function closeSettings() { document.getElementById('settings-overlay').classList.remove('open') }

function handleThemeToggle(checkbox) {
  isDark = checkbox.checked
  html.setAttribute('data-theme', isDark ? 'dark' : 'light')
  if (tempChart) updateChartThemes()
}

function switchTab(name, navBtn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'))

  document.getElementById('tab-' + name).classList.add('active')
  document.getElementById('tab-' + name + '-btn').classList.add('active')
  if (navBtn) navBtn.classList.add('active')

  document.getElementById('search-form').style.display = name === 'explore' ? 'flex' : 'none'

  if (chatOpen) toggleChat()
}

function toggleChat() {
  chatOpen = !chatOpen
  chatPanel.classList.toggle('visible', chatOpen)
  chatToggleBtn.classList.toggle('open', chatOpen)
  chatToggleBtn.classList.remove('has-msg')

  if (chatOpen) {
    setTimeout(() => document.getElementById('chat-input').focus(), 240)
    document.getElementById('chat-messages').scrollTop = 9999
  }
}

function buildWeatherContext() {
  if (!currentWeatherData) return 'No weather data available yet. User has not searched a city.'

  const w = currentWeatherData
  const weather = w.weather[0]
  const windSpeedKph = Math.round(w.wind.speed * 3.6)
  const windDir = degToCompass(w.wind.deg)
  const sunrise = formatTime12h(w.sys.sunrise, w.timezone)
  const sunset  = formatTime12h(w.sys.sunset, w.timezone)
  const visKm   = (w.visibility / 1000).toFixed(1)

  let ctx = `=== LIVE WEATHER DATA FOR ${w.name.toUpperCase()}, ${w.sys.country} ===
Temperature: ${Math.round(w.main.temp)}°C (feels like ${Math.round(w.main.feels_like)}°C)
Condition: ${weather.description}
Humidity: ${w.main.humidity}%
Pressure: ${w.main.pressure} hPa
Visibility: ${visKm} km
Wind: ${windSpeedKph} km/h ${windDir}
Sunrise: ${sunrise} | Sunset: ${sunset}
Min/Max today: ${Math.round(w.main.temp_min)}°C / ${Math.round(w.main.temp_max)}°C`

  if (currentAqiData) {
    const aqi = currentAqiData.list[0].main.aqi
    const c = currentAqiData.list[0].components
    const aqiLabel = getAqiLabel(aqi)
    const pol = { 'PM2.5': c.pm2_5, 'PM10': c.pm10, 'NO2': c.no2, 'O3': c.o3, 'SO2': c.so2, 'CO': c.co }
    const [mainPol, mainVal] = Object.entries(pol).sort((a, b) => b[1] - a[1])[0]
    ctx += `\n\n=== AIR QUALITY ===
AQI Index: ${aqi} (${aqiLabel})
Main pollutant: ${mainPol} at ${mainVal.toFixed(1)} µg/m³
PM2.5: ${c.pm2_5.toFixed(1)} | PM10: ${c.pm10.toFixed(1)} | NO2: ${c.no2.toFixed(1)} | O3: ${c.o3.toFixed(1)}`
  }

  if (currentForecastData) {
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const dy = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    const dailyMap = buildDailyMap(currentForecastData.list)
    const slice = Object.values(dailyMap).slice(0, 5)

    ctx += `\n\n=== 5-DAY FORECAST ===`
    slice.forEach(day => {
      const d = new Date(day.dt * 1000)
      ctx += `\n${dy[d.getDay()]} ${mo[d.getMonth()]} ${d.getDate()}: ${day.description}, High ${Math.round(day.max)}°C / Low ${Math.round(day.min)}°C, Humidity ${day.humidity}%, Wind ${Math.round(day.windKph)} km/h`
    })

    const slots = currentForecastData.list.slice(0, 8)
    ctx += `\n\n=== HOURLY NEXT 24H ===`
    slots.forEach(item => {
      const h = new Date(item.dt * 1000)
      const label = `${(h.getHours() % 12) || 12}${h.getHours() >= 12 ? 'PM' : 'AM'}`
      const rain = (item.rain?.['3h'] ?? 0).toFixed(1)
      ctx += `\n${label}: ${Math.round(item.main.temp)}°C, ${item.weather[0].description}, rain ${rain}mm, wind ${Math.round(item.wind.speed * 3.6)} km/h`
    })
  }
  return ctx
}

async function getBotReply(userMsg, city) {
  const weatherCtx = buildWeatherContext()
  const systemPrompt = `You are Lakbay Assistant, a friendly Filipino travel guide chatbot embedded in "Lakbay" — a travel and weather app.

${city ? `The user is currently exploring: ${city}.` : 'No city selected yet.'}

You have access to REAL-TIME weather data from the app. Use it to answer weather questions accurately and specifically — never guess or give generic answers when you have exact data.

${weatherCtx}

Guidelines:
- For ANY weather-related question, use the exact numbers from the data above (temperature, humidity, wind speed, AQI, forecast, etc.)
- Answer in a friendly, conversational tone
- Mix Tagalog and English naturally (Taglish) when appropriate
- Keep answers concise but helpful (3-6 lines max)
- Use emojis sparingly to keep it lively
- For travel tips, local food, transport, culture, budget, safety — use your knowledge
- If asked something unrelated to travel or weather, politely redirect`

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.href,
      'X-Title': 'Lakbay'
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: 350,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
      ]
    })
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || 'OpenRouter error')
  }

  const data = await response.json()
  return data.choices[0].message.content.trim()
}

async function handleChat() {
  const inp = document.getElementById('chat-input')
  const msg = inp.value.trim()
  if (!msg) return

  appendMsg(msg, 'user')
  inp.value = ''
  inp.style.height = 'auto'

  const sendBtn = document.getElementById('chat-send-btn')
  sendBtn.disabled = true
  document.getElementById('chat-suggestions').style.display = 'none'

  showTyping()
  try {
    const reply = await getBotReply(msg, currentCity)
    removeTyping()
    appendMsg(reply, 'bot')
  } catch (e) {
    removeTyping()
    appendMsg(`Sorry, may problema sa connection. (${e.message}) 😅 Try again!`, 'bot')
  } finally {
    sendBtn.disabled = false
    if (!chatOpen) chatToggleBtn.classList.add('has-msg')
  }
}

function sendSuggestion(btn) {
  document.getElementById('chat-input').value = btn.textContent.trim()
  handleChat()
}

function appendMsg(text, who) {
  const msgs = document.getElementById('chat-messages')
  const div = document.createElement('div')
  div.className = `msg ${who}`

  const av = document.createElement('div')
  av.className = `msg-avatar ${who === 'bot' ? 'bot' : 'user-av'}`
  av.innerHTML = who === 'bot'
    ? '<i class="fa-brands fa-android"></i>'
    : '<i class="fa-solid fa-user"></i>'

  const bubble = document.createElement('div')
  bubble.className = 'msg-bubble'
  bubble.innerHTML = text
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')

  div.appendChild(av)
  div.appendChild(bubble)
  msgs.appendChild(div)
  msgs.scrollTop = msgs.scrollHeight
}

function showTyping() {
  const msgs = document.getElementById('chat-messages')
  const div = document.createElement('div')
  div.className = 'msg bot'
  div.id = 'typing-msg'
  div.innerHTML = `<div class="msg-avatar bot"><i class="fa-brands fa-android"></i></div>
    <div class="msg-bubble typing-indicator">
      <div class="t-dot"></div><div class="t-dot"></div><div class="t-dot"></div>
    </div>`
  msgs.appendChild(div)
  msgs.scrollTop = msgs.scrollHeight
}

function removeTyping() {
  const el = document.getElementById('typing-msg')
  if (el) el.remove()
}

document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat() }
})

// Auto-resize chat textarea
document.getElementById('chat-input').addEventListener('input', function () {
  this.style.height = 'auto'
  this.style.height = Math.min(this.scrollHeight, 68) + 'px'
})

function getEmoji(id) {
  if (id >= 200 && id < 300) return '⛈️'
  if (id >= 300 && id < 400) return '🌦️'
  if (id >= 500 && id < 600) return '🌧️'
  if (id >= 600 && id < 700) return '❄️'
  if (id >= 700 && id < 800) return '🌫️'
  if (id === 800) return '☀️'
  if (id === 801) return '🌤️'
  if (id === 802) return '⛅'
  if (id >= 803) return '☁️'
  return '🌡️'
}

function formatTime12h(u, tz) {
  const tot = u + tz
  const h24 = Math.floor((tot % 86400 + 86400) % 86400 / 3600)
  const m   = Math.floor((tot % 3600 + 3600) % 3600 / 60)
  const ap  = h24 >= 12 ? 'PM' : 'AM'
  const h12 = String((h24 % 12) || 12).padStart(2, '0')
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`
}

function degToCompass(d) {
  if (d == null) return ''
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8]
}

function getAqiLabel(a) {
  return ['Good', 'Fair', 'Moderate', 'Poor', 'Very Poor'][Math.min(a - 1, 4)] || 'N/A'
}

function showError(msg) {
  errToast.textContent = msg
  errToast.style.display = 'block'
  setTimeout(() => { errToast.style.display = 'none' }, 4500)
}

function hideLoading() {
  overlay.style.opacity = '0'
  setTimeout(() => { overlay.style.display = 'none'; content.style.opacity = '1' }, 400)
}

function updateSunArc(sr, ss, tz) {
  const now = Math.floor(Date.now() / 1000) + tz
  const s = sr + tz, e = ss + tz
  const t = Math.max(0, Math.min(1, (now - s) / (e - s)))

  const bx = (1 - t) * (1 - t) * 10 + 2 * (1 - t) * t * 110 + t * t * 210
  const by = (1 - t) * (1 - t) * 80 + 2 * (1 - t) * t * (-10) + t * t * 80

  const dot  = document.getElementById('sun-dot')
  const glow = document.getElementById('sun-dot-glow')
  const arc  = document.getElementById('arc-progress')

  if (dot)  { dot.setAttribute('cx', bx);  dot.setAttribute('cy', by) }
  if (glow) { glow.setAttribute('cx', bx); glow.setAttribute('cy', by) }
  if (arc)  arc.setAttribute('stroke-dashoffset', 260 * (1 - t))
}

function updateMiniArc(sr, ss, tz) {
  const now = Math.floor(Date.now() / 1000) + tz
  const s = sr + tz, e = ss + tz
  const t = Math.max(0, Math.min(1, (now - s) / (e - s)))

  const bx = (1 - t) * (1 - t) * 10 + 2 * (1 - t) * t * 110 + t * t * 210
  const by = (1 - t) * (1 - t) * 70 + 2 * (1 - t) * t * (-5) + t * t * 70

  const dot  = document.getElementById('mini-sun-dot')
  const glow = document.getElementById('mini-sun-glow')
  const arc  = document.getElementById('mini-arc-progress')

  if (dot)  { dot.setAttribute('cx', bx);  dot.setAttribute('cy', by) }
  if (glow) { glow.setAttribute('cx', bx); glow.setAttribute('cy', by) }
  if (arc)  arc.setAttribute('stroke-dashoffset', 240 * (1 - t))
}

function renderWeather(d) {
  currentWeatherData = d
  const w = d.weather[0]
  const wk = Math.round(d.wind.speed * 3.6)
  const wd = degToCompass(d.wind.deg)

  // Weather card
  document.getElementById('wc-icon').textContent    = getEmoji(w.id)
  document.getElementById('wc-temp').innerHTML      = `${Math.round(d.main.temp)}<em>°C</em>`
  document.getElementById('wc-desc').textContent    = w.description
  document.getElementById('wc-feels').textContent   = `Feels like ${Math.round(d.main.feels_like)}°C`
  document.getElementById('wc-pressure').textContent = `${d.main.pressure} mb`
  document.getElementById('wc-vis').textContent     = `${(d.visibility / 1000).toFixed(1)} km`
  document.getElementById('wc-hum').textContent     = `${d.main.humidity}%`

  // Weather sidebar
  document.getElementById('ws-city').textContent    = d.name
  document.getElementById('ws-country').textContent = `📍 ${d.sys.country}`
  document.getElementById('ws-temp-big').textContent = `${Math.round(d.main.temp)}°`

  // Location bar in weather main
  const locBar = document.getElementById('w-location-bar')
  if (locBar) locBar.style.display = 'flex'
  const locLabel = document.getElementById('w-location-label')
  const locSub   = document.getElementById('w-location-sub')
  if (locLabel) locLabel.textContent = d.name
  if (locSub) locSub.textContent = `${d.sys.country} · ${new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}`

  // Sun times
  document.getElementById('rt-sunrise').textContent = formatTime12h(d.sys.sunrise, d.timezone)
  document.getElementById('rt-sunset').textContent  = formatTime12h(d.sys.sunset, d.timezone)
  document.getElementById('aqi-wind').textContent   = `${getEmoji(w.id)} ${w.description} · ${wk} km/h ${wd}`

  updateSunArc(d.sys.sunrise, d.sys.sunset, d.timezone)

  // Mini weather in explore sidebar
  document.getElementById('mw-placeholder').style.display = 'none'
  document.getElementById('mw-content').style.display     = 'block'
  document.getElementById('mw-icon').textContent  = getEmoji(w.id)
  document.getElementById('mw-temp').textContent  = `${Math.round(d.main.temp)}°C`
  document.getElementById('mw-desc').textContent  = w.description
  document.getElementById('mw-feels').textContent = `${Math.round(d.main.feels_like)}°C`
  document.getElementById('mw-hum').textContent   = `${d.main.humidity}%`
  document.getElementById('mw-wind').textContent  = `${wk} km/h`
  document.getElementById('mini-sunrise').textContent = formatTime12h(d.sys.sunrise, d.timezone)
  document.getElementById('mini-sunset').textContent  = formatTime12h(d.sys.sunset, d.timezone)

  updateMiniArc(d.sys.sunrise, d.sys.sunset, d.timezone)
}

function renderAqi(data) {
  currentAqiData = data
  const aqi = data.list[0].main.aqi
  const c   = data.list[0].components

  document.getElementById('aqi-number').textContent = aqi
  document.getElementById('aqi-badge').textContent  = getAqiLabel(aqi)

  const pol = { 'PM2.5': c.pm2_5, 'PM10': c.pm10, 'NO₂': c.no2, 'O₃': c.o3, 'SO₂': c.so2, 'CO': c.co }
  const [n, v] = Object.entries(pol).sort((a, b) => b[1] - a[1])[0]
  document.getElementById('aqi-pollutant').textContent = `Main pollutant: ${n} · ${v.toFixed(1)} µg/m³`

  setTimeout(() => {
    document.getElementById('aqi-cursor').style.left = ((aqi - 1) / 4 * 90 + 5) + '%'
  }, 150)
}

function buildDailyMap(list) {
  const days = {}
  list.forEach(item => {
    const date = item.dt_txt.split(' ')[0]
    if (!days[date]) {
      days[date] = {
        dt: item.dt, max: -Infinity, min: Infinity,
        description: item.weather[0].description,
        icon: item.weather[0].id,
        humidity: item.main.humidity,
        windKph: item.wind.speed * 3.6,
        count: 0
      }
    }
    days[date].max = Math.max(days[date].max, item.main.temp_max)
    days[date].min = Math.min(days[date].min, item.main.temp_min)
    const hour = item.dt_txt.split(' ')[1]
    if (hour >= '11:00:00' && hour <= '14:00:00') {
      days[date].description = item.weather[0].description
      days[date].icon        = item.weather[0].id
      days[date].humidity    = item.main.humidity
      days[date].windKph     = item.wind.speed * 3.6
    }
    days[date].count++
  })
  return days
}

function renderForecast(data) {
  currentForecastData = data
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dy = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const dailyMap = buildDailyMap(data.list)
  const slice = Object.values(dailyMap).slice(0, 5)

  // Main forecast list (weather sidebar)
  const fcList = document.getElementById('fc-list')
  fcList.innerHTML = ''
  slice.forEach((day, i) => {
    const d = new Date(day.dt * 1000)
    const el = document.createElement('div')
    el.className = 'fc-item'
    el.style.animationDelay = `${i * 0.07}s`
    el.innerHTML = `
      <div class="fci-date">${mo[d.getMonth()]} ${d.getDate()}<br><span style="font-size:0.58rem">${dy[d.getDay()]}</span></div>
      <div class="fci-icon">${getEmoji(day.icon)}</div>
      <div class="fci-label">${day.description}</div>
      <div class="fci-temps"><span>${Math.round(day.max)}°</span> / ${Math.round(day.min)}°</div>`
    fcList.appendChild(el)
  })

  // Mini forecast (explore sidebar)
  const mini = document.getElementById('fc-mini-list')
  mini.innerHTML = ''
  slice.forEach((day, i) => {
    const d = new Date(day.dt * 1000)
    const el = document.createElement('div')
    el.className = 'fc-mini-item'
    el.style.animationDelay = `${i * 0.07}s`
    el.innerHTML = `
      <div class="fmi-day">${dy[d.getDay()]} ${d.getDate()}</div>
      <div class="fmi-icon">${getEmoji(day.icon)}</div>
      <div class="fmi-temp"><span>${Math.round(day.max)}°</span>/${Math.round(day.min)}°</div>`
    mini.appendChild(el)
  })

  renderAllCharts(data)
}

function makeChartOptions(unit, color) {
  const gc = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'
  const lc = isDark ? '#427070' : '#7a9aaa'
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500, easing: 'easeInOutQuart' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: isDark ? '#1a2828' : '#fff',
        titleColor: isDark ? '#ddf0f0' : '#18282e',
        bodyColor: color,
        borderColor: isDark ? '#1c2e2e' : '#e4eaee',
        borderWidth: 1, padding: 10,
        callbacks: { label: ctx => `${ctx.raw}${unit}` }
      }
    },
    scales: {
      x: { grid: { color: gc }, ticks: { color: lc, font: { family: 'Instrument Sans', size: 10 } } },
      y: { grid: { color: gc }, ticks: { color: lc, font: { family: 'Instrument Sans', size: 10 }, callback: v => v + unit } }
    }
  }
}

function renderAllCharts(fData) {
  const slots  = fData.list.slice(0, 8)
  const labels = slots.map(s => {
    const h = new Date(s.dt * 1000).getHours()
    return `${(h % 12) || 12}${h >= 12 ? 'PM' : 'AM'}`
  })

  if (tempChart) tempChart.destroy()
  if (rainChart) rainChart.destroy()
  if (windChart) windChart.destroy()

  tempChart = new Chart(document.getElementById('tempChart').getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{ data: slots.map(s => Math.round(s.main.temp)), borderColor: '#e8722a', backgroundColor: '#e8722a15', pointBackgroundColor: '#e8722a', pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.5, fill: true, tension: 0.4 }] },
    options: makeChartOptions('°C', '#e8722a')
  })

  rainChart = new Chart(document.getElementById('rainChart').getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ data: slots.map(s => +(s.rain?.['3h'] ?? 0).toFixed(1)), backgroundColor: '#2aadad28', borderColor: '#2aadad', borderWidth: 1.5, borderRadius: 4 }] },
    options: makeChartOptions(' mm', '#2aadad')
  })

  windChart = new Chart(document.getElementById('windChart').getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{ data: slots.map(s => Math.round(s.wind.speed * 3.6)), borderColor: '#8b6fd4', backgroundColor: '#8b6fd415', pointBackgroundColor: '#8b6fd4', pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.5, fill: true, tension: 0.4 }] },
    options: makeChartOptions(' km/h', '#8b6fd4')
  })
}

function updateChartThemes() {
  ;[tempChart, rainChart, windChart].forEach(chart => {
    if (!chart) return
    const gc = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'
    const lc = isDark ? '#427070' : '#7a9aaa'
    chart.options.scales.x.grid.color  = gc
    chart.options.scales.x.ticks.color = lc
    chart.options.scales.y.grid.color  = gc
    chart.options.scales.y.ticks.color = lc
    chart.options.plugins.tooltip.backgroundColor = isDark ? '#1a2828' : '#fff'
    chart.options.plugins.tooltip.titleColor = isDark ? '#ddf0f0' : '#18282e'
    chart.update()
  })
}

const KIND_META = {
  museums: { icon: '🏛️', kw: 'museum' }, art_galleries: { icon: '🖼️', kw: 'art gallery' },
  cultural: { icon: '🎭', kw: 'cultural' }, historic: { icon: '🏰', kw: 'historic' },
  historic_architecture: { icon: '🏛️', kw: 'architecture' }, fortifications: { icon: '🏰', kw: 'castle' },
  monuments_and_memorials: { icon: '🗿', kw: 'monument' }, archaeological_sites: { icon: '🏺', kw: 'ruins' },
  churches: { icon: '⛪', kw: 'church' }, religion: { icon: '🛕', kw: 'temple' },
  buddhist_temples: { icon: '🛕', kw: 'buddhist temple' }, mosques: { icon: '🕌', kw: 'mosque' },
  natural: { icon: '🌿', kw: 'nature' }, gardens_and_parks: { icon: '🌳', kw: 'park' },
  water: { icon: '💧', kw: 'waterfall' }, beaches: { icon: '🏖️', kw: 'beach' },
  mountains: { icon: '⛰️', kw: 'mountain' }, forests: { icon: '🌲', kw: 'forest' },
  amusements: { icon: '🎡', kw: 'amusement park' }, sport: { icon: '🏟️', kw: 'stadium' },
  cinemas: { icon: '🎬', kw: 'cinema' }, theatre_and_dance: { icon: '🎭', kw: 'theater' },
  concert_halls: { icon: '🎵', kw: 'concert hall' }, shops: { icon: '🛍️', kw: 'market' },
  restaurants: { icon: '🍽️', kw: 'restaurant' }, hotels: { icon: '🏨', kw: 'hotel' }
}

function getMeta(k) {
  if (!k) return { icon: '📍', kw: 'tourist attraction' }
  const p = k.toLowerCase().split(',').map(s => s.trim())
  for (const x of p) if (KIND_META[x]) return KIND_META[x]
  return { icon: '📍', kw: p[0].replace(/_/g, ' ') || 'tourist attraction' }
}

const NATURE_KINDS = ['natural', 'gardens_and_parks', 'water', 'beaches', 'mountains', 'forests', 'nature_reserves']

function setExploreStatus(msg, err) {
  const el = document.getElementById('explore-status')
  el.textContent = msg
  el.className = 'explore-status' + (err ? ' err' : '')
}

async function fetchPlaces(lat, lon) {
  setExploreStatus('Fetching places…')
  const grid = document.getElementById('place-grid')
  grid.innerHTML = '<div class="grid-loader active"><div class="g-spinner"></div></div>'
  document.getElementById('load-more-wrap').style.display = 'none'
  allPlaces = []; placePage = 0

  try {
    const res = await fetch(`${OTM_BASE}/radius?radius=15000&lon=${lon}&lat=${lat}&kinds=${selectedKind}&rate=2&limit=100&apikey=${OTM_KEY}`)
    const data = await res.json()
    const raw = (data.features || []).filter(f => f.properties.name)

    // Deduplicate by name
    const seen = {}
    const deduped = raw.filter(f => {
      const key = f.properties.name.toLowerCase().replace(/[\s\-'",\.]+/g, '')
      if (seen[key]) return false
      seen[key] = true
      return true
    })

    // Sort nature spots first
    deduped.sort((a, b) => {
      const ak = (a.properties.kinds || '').toLowerCase()
      const bk = (b.properties.kinds || '').toLowerCase()
      const an = NATURE_KINDS.some(k => ak.includes(k))
      const bn = NATURE_KINDS.some(k => bk.includes(k))
      return an && !bn ? -1 : !an && bn ? 1 : 0
    })

    allPlaces = deduped
    grid.innerHTML = ''

    if (!allPlaces.length) {
      grid.innerHTML = '<div class="explore-empty"><div class="ei">🗺️</div><p>No tourist spots found. Try another city!</p></div>'
      setExploreStatus('')
      return
    }

    setExploreStatus(`${allPlaces.length} places found in ${currentCity}`)
    document.getElementById('explore-count').textContent = allPlaces.length + ' places'
    renderPlacePage()

    setTimeout(() => {
      appendMsg(`You're now exploring **${currentCity}** \nWhat would you like to know?`, 'bot')
      if (!chatOpen) chatToggleBtn.classList.add('has-msg')
    }, 1200)

  } catch (e) {
    grid.innerHTML = '<div class="explore-empty"><div class="ei">⚠️</div><p>Could not load places. Check connection.</p></div>'
    setExploreStatus('Failed to load places.', true)
  }
}

function padGridPhantoms() {
  const grid = document.getElementById('place-grid')
  grid.querySelectorAll('.place-card-phantom').forEach(p => p.remove())
  const realCards = grid.querySelectorAll('.place-card').length
  if (!realCards) return
  const COLS = 5
  const remainder = realCards % COLS
  if (remainder !== 0) {
    const needed = COLS - remainder
    for (let i = 0; i < needed; i++) {
      const ph = document.createElement('div')
      ph.className = 'place-card-phantom'
      grid.appendChild(ph)
    }
  }
}

function renderPlacePage() {
  const grid = document.getElementById('place-grid')
  grid.querySelectorAll('.place-card-phantom').forEach(p => p.remove())

  const start = placePage * PAGE_SIZE
  allPlaces.slice(start, start + PAGE_SIZE).forEach((f, i) => grid.appendChild(buildPlaceCard(f, start + i)))
  placePage++

  const hasMore = placePage * PAGE_SIZE < allPlaces.length
  document.getElementById('load-more-wrap').style.display = hasMore ? 'block' : 'none'
  padGridPhantoms()
}

function buildPlaceCard(feature, idx) {
  const p    = feature.properties
  const xid  = p.xid
  const name = p.name || 'Unnamed Place'
  const tags = (p.kinds || '').split(',').slice(0, 2).map(k => k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()))
  const rate = p.rate || 0
  const filled = '★'.repeat(Math.min(rate, 5))
  const empty  = '★'.repeat(Math.max(0, 5 - rate))
  const meta   = getMeta(p.kinds)

  const card = document.createElement('div')
  card.className = 'place-card'
  card.style.animationDelay = (idx % PAGE_SIZE) * 50 + 'ms'
  card.innerHTML = `
    <div class="card-img loading" id="cimg-${xid}"></div>
    <div class="card-body">
      <div class="card-tags">${tags.map(t => `<span class="card-tag">${t}</span>`).join('')}</div>
      <div class="card-name">${name}</div>
      <div class="card-addr" id="caddr-${xid}">Loading…</div>
      <div class="card-footer">
        <div class="card-stars">${filled}<span>${empty}</span></div>
        <a class="card-link" href="https://opentripmap.com/en/card/${xid}" target="_blank">View →</a>
      </div>
    </div>`

  setTimeout(() => fetchPlaceDetail(xid, name, p.kinds, meta), idx * 140)
  return card
}

async function fetchPlaceDetail(xid, fallbackName, kindsStr, meta) {
  const slot = document.getElementById('cimg-' + xid)
  if (!slot) return

  try {
    const res  = await fetch(`${OTM_BASE}/xid/${xid}?apikey=${OTM_KEY}`)
    const data = await res.json()

    const addrEl = document.getElementById('caddr-' + xid)
    if (addrEl) {
      const a = data.address
      addrEl.textContent = a
        ? ([a.road, a.city, a.state, a.country].filter(Boolean).join(', ') || 'No address')
        : 'No address available'
    }

    const placeName = data.name || fallbackName || ''
    const otmUrl = (data.preview && data.preview.source) || data.image || null
    if (otmUrl && await tryLoadImg(slot, otmUrl, placeName)) return

    const wikiUrl = await getWikiThumb(placeName)
    if (wikiUrl && await tryLoadImg(slot, wikiUrl, placeName)) return

    const commonsUrl = await getCommonsImg(placeName, currentCity, meta.kw)
    if (commonsUrl && await tryLoadImg(slot, commonsUrl, placeName)) return

  } catch (e) { }

  showImgFallback(slot, meta)
}

function tryLoadImg(slot, src, alt) {
  return new Promise(resolve => {
    const img = new Image()
    const t = setTimeout(() => resolve(false), 8000)
    img.onload = () => {
      clearTimeout(t)
      slot.classList.remove('loading', 'fallback-bg')
      slot.innerHTML = ''
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block'
      img.alt = alt || ''
      slot.appendChild(img)
      resolve(true)
    }
    img.onerror = () => { clearTimeout(t); resolve(false) }
    img.src = src
  })
}

function showImgFallback(slot, meta) {
  slot.classList.remove('loading')
  slot.classList.add('fallback-bg')
  slot.style.background = 'linear-gradient(135deg,#141e1a 0%,#1a2820 60%,#121e14 100%)'
  slot.innerHTML = `<span class="fallback-icon">${meta.icon}</span><span class="fallback-label">${meta.kw}</span>`
}

async function getWikiThumb(name) {
  if (!name || name.trim().length < 2) return null
  try {
    const res  = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(name)}&prop=pageimages&format=json&pithumbsize=600&origin=*`)
    const data = await res.json()
    const pages = data?.query?.pages
    if (!pages) return null
    const page = Object.values(pages)[0]
    if (!page || page.missing !== undefined) return null
    return page.thumbnail?.source || null
  } catch (e) { return null }
}

async function getCommonsImg(placeName, city, kw) {
  const queries = []
  if (placeName?.length > 1) {
    queries.push(placeName)
    if (city) queries.push(placeName + ' ' + city)
  }
  if (city && kw) queries.push(city + ' ' + kw)
  if (kw) queries.push(kw)

  for (const q of queries) {
    try {
      const res  = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srnamespace=6&srlimit=5&format=json&origin=*`)
      const data = await res.json()
      const items = data?.query?.search
      if (!items?.length) continue
      for (const item of items) {
        if (!/\.(jpe?g|png|webp)$/i.test(item.title)) continue
        const url = await getCommonsFileUrl(item.title)
        if (url) return url
      }
    } catch (e) { continue }
  }
  return null
}

async function getCommonsFileUrl(title) {
  try {
    const res  = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url&iiurlwidth=600&format=json&origin=*`)
    const data = await res.json()
    const pages = data?.query?.pages
    if (!pages) return null
    const info = Object.values(pages)[0]?.imageinfo?.[0]
    return info?.thumburl || info?.url || null
  } catch (e) { return null }
}

async function fetchAll(query) {
  searchBtn.disabled = true
  overlay.style.display = 'flex'
  overlay.style.opacity = '1'
  content.style.opacity = '0'

  const qs = typeof query === 'string'
    ? `q=${encodeURIComponent(query)}`
    : `lat=${query.lat}&lon=${query.lon}`

  try {
    const [cRes, fRes] = await Promise.all([
      fetch(`${OWM_BASE}/weather?${qs}&appid=${OWM_KEY}&units=metric`),
      fetch(`${OWM_BASE}/forecast?${qs}&appid=${OWM_KEY}&units=metric`)
    ])

    if (!cRes.ok) {
      const err = await cRes.json().catch(() => ({}))
      throw new Error(err.message || 'Hindi mahanap ang city.')
    }

    const [cData, fData] = await Promise.all([cRes.json(), fRes.json()])
    const { lat, lon } = cData.coord
    currentCity = cData.name

    const aqiRes  = await fetch(`${OWM_BASE}/air_pollution?lat=${lat}&lon=${lon}&appid=${OWM_KEY}`)
    const aqiData = await aqiRes.json()

    renderWeather(cData)
    renderAqi(aqiData)
    renderForecast(fData)

    document.getElementById('explore-title').textContent = cData.name + ', ' + cData.sys.country

    hideLoading()
    fetchPlaces(lat, lon)

  } catch (err) {
    hideLoading()
    showError('❌ ' + err.message)
  } finally {
    searchBtn.disabled = false
  }
}

document.getElementById('filter-chips').addEventListener('click', e => {
  const chip = e.target.closest('.filter-chip')
  if (!chip) return
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'))
  chip.classList.add('active')
  selectedKind = chip.dataset.kind
  if (currentCity && currentWeatherData) {
    const { lat, lon } = currentWeatherData.coord
    document.getElementById('place-grid').innerHTML = ''
    fetchPlaces(lat, lon)
  }
})

document.getElementById('load-more-btn').addEventListener('click', renderPlacePage)

searchForm.addEventListener('submit', e => {
  e.preventDefault()
  const city = searchInp.value.trim()
  if (!city) return
  fetchAll(city)
  searchInp.blur()
})

window.addEventListener('load', () => {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => fetchAll({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      ()  => fetchAll('Manila')
    )
  } else {
    fetchAll('Manila')
  }
})