/** Client-side venue weather (Open-Meteo). Cloud timeout is 3s, so home fetches here. */

const VENUE = {
  name: '界龙足球基地',
  address: '上海市浦东新区川沙镇界绿路88号',
  lat: 31.1858,
  lon: 121.7035
}

const HOURS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]

function dayKey(ms) {
  const shifted = new Date(Number(ms) + 8 * 60 * 60 * 1000)
  const y = shifted.getUTCFullYear()
  const m = shifted.getUTCMonth() + 1
  const d = shifted.getUTCDate()
  return `${y}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`
}

function weatherText(code) {
  const c = Number(code)
  if (c === 0 || c === 1) return '晴'
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
  return hour === 24 ? '24点' : `${hour}点`
}

function parseIsoHour(iso) {
  const m = String(iso).match(/T(\d{2}):/)
  return m ? Number(m[1]) : -1
}

function parseIsoDay(iso) {
  return String(iso).slice(0, 10)
}

function clockMinutes(iso) {
  const m = String(iso).match(/T(\d{2}):(\d{2})/)
  if (!m) return 18 * 60
  return Number(m[1]) * 60 + Number(m[2])
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

function buildHours(forecast, day) {
  const times = (forecast.hourly && forecast.hourly.time) || []
  const temps = (forecast.hourly && forecast.hourly.temperature_2m) || []
  const codes = (forecast.hourly && forecast.hourly.weather_code) || []
  const winds = (forecast.hourly && forecast.hourly.wind_speed_10m) || []
  const dailyTimes = (forecast.daily && forecast.daily.time) || []
  const dayIdx = dailyTimes.indexOf(day)
  const sunriseIso = dayIdx >= 0 ? (forecast.daily.sunrise || [])[dayIdx] : ''
  const sunsetIso = dayIdx >= 0 ? (forecast.daily.sunset || [])[dayIdx] : ''
  const riseMin = clockMinutes(sunriseIso || 'T06:00')
  const setMin = clockMinutes(sunsetIso || 'T18:00')
  const hours = []
  for (const hour of HOURS) {
    const fi = indexByTimeDay(times, day, hour)
    if (fi < 0) continue
    const code = codes[fi]
    const night = isNightAt(hour, riseMin, setMin)
    const aqiMeta = aqiLabel(null)
    hours.push({
      hour,
      label: clockLabel(hour),
      tipLabel: tipHourLabel(hour),
      temp: Math.round(Number(temps[fi])),
      text: weatherText(code),
      icon: weatherIcon(code, night),
      windLevel: windLevel(winds[fi]),
      aqi: null,
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

function forecastDaysNeeded(startTimeMs) {
  const diffDays = Math.ceil((startTimeMs - Date.now()) / 86400000) + 1
  return Math.max(1, Math.min(16, diffDays + 1))
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      timeout: 15000,
      success: (res) => {
        if (res.statusCode >= 400 || !res.data) {
          reject(new Error('天气服务不可用'))
          return
        }
        resolve(res.data)
      },
      fail: () => reject(new Error('天气服务请求失败'))
    })
  })
}

function loadActivityWeather(startTime) {
  const ms = Number(startTime)
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.reject(new Error('缺少活动时间'))
  }
  const day = dayKey(ms)
  const days = forecastDaysNeeded(ms)
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${VENUE.lat}&longitude=${VENUE.lon}`
    + `&timezone=Asia%2FShanghai&hourly=temperature_2m,weather_code,wind_speed_10m`
    + `&daily=sunrise,sunset&forecast_days=${days}`
  const fromForecast = (forecast) => {
    const built = buildHours(forecast, day)
    if (!built.hours.length) throw new Error('该日暂无小时预报')
    let defaultIndex = built.hours.findIndex((h) => h.hour === 20)
    if (defaultIndex < 0) defaultIndex = Math.min(built.hours.length - 1, Math.floor(built.hours.length / 2))
    return {
      venue: VENUE,
      day,
      sunrise: built.sunrise,
      sunset: built.sunset,
      defaultIndex,
      hours: built.hours,
      venueAddress: `${VENUE.address}，${VENUE.name}`
    }
  }
  const fromCloud = () => new Promise((resolve, reject) => {
    if (!wx.cloud || !wx.cloud.callFunction) {
      reject(new Error('天气服务请求失败'))
      return
    }
    wx.cloud.callFunction({
      name: 'api',
      data: { action: 'activityWeather', startTime: ms },
      success: (res) => {
        const result = (res && res.result) || {}
        if (!result.ok || !(result.hours || []).length) {
          reject(new Error(result.message || '天气服务不可用'))
          return
        }
        resolve({
          venue: VENUE,
          day: result.day || day,
          sunrise: result.sunrise || '',
          sunset: result.sunset || '',
          defaultIndex: typeof result.defaultIndex === 'number' ? result.defaultIndex : 0,
          hours: result.hours,
          venueAddress: `${VENUE.address}，${VENUE.name}`
        })
      },
      fail: () => reject(new Error('天气服务请求失败'))
    })
  })
  // 体验版会校验 request 合法域名；直连失败时改走云函数，避免首页空白。
  return requestJson(url).then(fromForecast).catch(() => fromCloud())
}

module.exports = {
  VENUE,
  loadActivityWeather
}
