/** Venue-fixed hourly forecast helpers (Open-Meteo). */

const VENUE = {
  name: '界龙足球基地',
  address: '上海市浦东新区川沙镇界绿路88号',
  lat: 31.1858,
  lon: 121.7035
}

const HOURS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]

function shanghaiDateParts(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(ms))
  const get = (type) => parts.find((p) => p.type === type).value
  return { year: get('year'), month: get('month'), day: get('day') }
}

function dayKey(ms) {
  const { year, month, day } = shanghaiDateParts(ms)
  return `${year}-${month}-${day}`
}

function weatherText(code) {
  const c = Number(code)
  if (c === 0) return '晴'
  if (c === 1) return '晴'
  if (c === 2) return '多云'
  if (c === 3) return '阴'
  if (c === 45 || c === 48) return '雾'
  if (c >= 51 && c <= 57) return '毛毛雨'
  if (c >= 61 && c <= 67) return '雨'
  if (c >= 71 && c <= 77) return '雪'
  if (c >= 80 && c <= 82) return '阵雨'
  if (c >= 85 && c <= 86) return '阵雪'
  if (c >= 95 && c <= 99) return '雷雨'
  return '多云'
}

function weatherIcon(code, isNight) {
  const c = Number(code)
  if (c === 0 || c === 1) return isNight ? '🌙' : '☀️'
  if (c === 2) return isNight ? '☁️' : '⛅'
  if (c === 3) return '☁️'
  if (c === 45 || c === 48) return '🌫️'
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return '🌧️'
  if ((c >= 71 && c <= 77) || (c >= 85 && c <= 86)) return '❄️'
  if (c >= 95 && c <= 99) return '⛈️'
  return isNight ? '🌙' : '☀️'
}

function windLevel(kmh) {
  const v = Number(kmh) || 0
  if (v < 1) return 0
  if (v <= 5) return 1
  if (v <= 11) return 2
  if (v <= 19) return 3
  if (v <= 28) return 4
  if (v <= 38) return 5
  if (v <= 49) return 6
  if (v <= 61) return 7
  return 8
}

function aqiLabel(euAqi) {
  if (euAqi == null || euAqi === '') return { level: '—', tone: 'unknown' }
  const v = Number(euAqi)
  if (!Number.isFinite(v)) return { level: '—', tone: 'unknown' }
  if (v <= 20) return { level: '优', tone: 'good' }
  if (v <= 40) return { level: '良', tone: 'ok' }
  if (v <= 60) return { level: '轻度', tone: 'light' }
  if (v <= 80) return { level: '中度', tone: 'mid' }
  if (v <= 100) return { level: '重度', tone: 'heavy' }
  return { level: '严重', tone: 'severe' }
}

function clockLabel(hour) {
  if (hour === 24) return '24:00'
  return `${hour < 10 ? '0' : ''}${hour}:00`
}

function tipHourLabel(hour) {
  if (hour === 24) return '24点'
  return `${hour}点`
}

function parseIsoHour(iso) {
  // 2026-10-30T20:00
  const m = String(iso).match(/T(\d{2}):/)
  return m ? Number(m[1]) : -1
}

function parseIsoDay(iso) {
  return String(iso).slice(0, 10)
}

function sunsetMinutes(iso) {
  // 2026-10-30T17:12
  const m = String(iso).match(/T(\d{2}):(\d{2})/)
  if (!m) return 18 * 60
  return Number(m[1]) * 60 + Number(m[2])
}

function sunriseMinutes(iso) {
  return sunsetMinutes(iso)
}

function formatClockFromIso(iso) {
  const m = String(iso).match(/T(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : ''
}

function isNightAt(hour, sunriseMin, sunsetMin) {
  const mins = hour === 24 ? 24 * 60 : hour * 60
  return mins < sunriseMin || mins >= sunsetMin
}

function indexByTimeDay(times, day, hour) {
  for (let i = 0; i < times.length; i += 1) {
    if (parseIsoDay(times[i]) !== day) continue
    if (hour === 24) continue
    if (parseIsoHour(times[i]) === hour) return i
  }
  if (hour === 24) {
    // next calendar day 00:00
    const [y, m, d] = day.split('-').map(Number)
    const next = new Date(Date.UTC(y, m - 1, d))
    next.setUTCDate(next.getUTCDate() + 1)
    const nextDay = next.toISOString().slice(0, 10)
    for (let i = 0; i < times.length; i += 1) {
      if (parseIsoDay(times[i]) === nextDay && parseIsoHour(times[i]) === 0) return i
    }
  }
  return -1
}

function buildHours(forecast, air, day) {
  const times = (forecast.hourly && forecast.hourly.time) || []
  const temps = (forecast.hourly && forecast.hourly.temperature_2m) || []
  const codes = (forecast.hourly && forecast.hourly.weather_code) || []
  const winds = (forecast.hourly && forecast.hourly.wind_speed_10m) || []
  const airTimes = (air.hourly && air.hourly.time) || []
  const aqis = (air.hourly && air.hourly.european_aqi) || []

  const dailyTimes = (forecast.daily && forecast.daily.time) || []
  const dayIdx = dailyTimes.indexOf(day)
  const sunriseIso = dayIdx >= 0 ? (forecast.daily.sunrise || [])[dayIdx] : ''
  const sunsetIso = dayIdx >= 0 ? (forecast.daily.sunset || [])[dayIdx] : ''
  const riseMin = sunriseMinutes(sunriseIso || 'T06:00')
  const setMin = sunsetMinutes(sunsetIso || 'T18:00')

  const hours = []
  for (const hour of HOURS) {
    const fi = indexByTimeDay(times, day, hour)
    if (fi < 0) continue
    const ai = indexByTimeDay(airTimes, day, hour)
    const code = codes[fi]
    const night = isNightAt(hour, riseMin, setMin)
    const aqi = ai >= 0 ? aqis[ai] : null
    const aqiMeta = aqiLabel(aqi)
    hours.push({
      hour,
      label: clockLabel(hour),
      tipLabel: tipHourLabel(hour),
      temp: Math.round(Number(temps[fi])),
      text: weatherText(code),
      icon: weatherIcon(code, night),
      windLevel: windLevel(winds[fi]),
      aqi: aqi == null ? null : Math.round(Number(aqi)),
      aqiLevel: aqiMeta.level,
      aqiTone: aqiMeta.tone
    })
  }
  return {
    hours,
    sunrise: formatClockFromIso(sunriseIso),
    sunset: formatClockFromIso(sunsetIso)
  }
}

function getJson(url, timeoutMs = 12000) {
  const https = require('https')
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error('天气服务不可用'))
          return
        }
        try {
          resolve(JSON.parse(raw))
        } catch (error) {
          reject(new Error('天气数据解析失败'))
        }
      })
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('天气服务超时'))
    })
    req.on('error', () => reject(new Error('天气服务请求失败')))
  })
}

function forecastDaysNeeded(startTimeMs) {
  const diffDays = Math.ceil((startTimeMs - Date.now()) / 86400000) + 1
  return Math.max(1, Math.min(16, diffDays + 1))
}

async function fetchActivityWeather(startTime) {
  const ms = Number(startTime)
  if (!Number.isFinite(ms) || ms <= 0) throw new Error('缺少活动时间')
  const day = dayKey(ms)
  const days = forecastDaysNeeded(ms)
  const common = `latitude=${VENUE.lat}&longitude=${VENUE.lon}&timezone=Asia%2FShanghai`
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?${common}`
    + `&hourly=temperature_2m,weather_code,wind_speed_10m`
    + `&daily=sunrise,sunset&forecast_days=${days}`
  // Skip AQI remote call to stay under cloud timeout; UI still shows empty/unknown tone.
  const air = { hourly: { time: [], european_aqi: [] } }
  const forecast = await getJson(forecastUrl, 10000)
  const built = buildHours(forecast, air, day)
  if (!built.hours.length) throw new Error('该日暂无小时预报')
  const defaultHour = 20
  let defaultIndex = built.hours.findIndex((h) => h.hour === defaultHour)
  if (defaultIndex < 0) defaultIndex = Math.min(built.hours.length - 1, Math.floor(built.hours.length / 2))
  return {
    venue: VENUE,
    day,
    sunrise: built.sunrise,
    sunset: built.sunset,
    defaultIndex,
    hours: built.hours
  }
}

module.exports = {
  VENUE,
  HOURS,
  weatherText,
  weatherIcon,
  windLevel,
  aqiLabel,
  buildHours,
  fetchActivityWeather,
  dayKey
}
