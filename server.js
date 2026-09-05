import express from 'express';
import cors from 'cors';
import axios from 'axios';
import Groq from 'groq-sdk';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number.parseInt(process.env.PORT || '5000', 10);
const host = process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json());

// Serve static HTML files from the "client" folder
app.use(express.static(path.join(__dirname, 'client')));

// Initialize Groq AI Client
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// User Profile State (In-memory storage)
let userProfile = {
  ageGroup: "18-25 Years",
  healthCondition: "Asthma",
  occupation: "Outdoor Worker",
  activityLevel: "High"
};

function getAQIStatus(aqi) {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  return "Very Unhealthy";
}

async function getWithRetry(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await axios.get(url, { timeout: 10000 });
    } catch (error) {
      const isTransient = ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(error.code)
        || !error.response
        || error.response.status >= 500;
      if (!isTransient || attempt === attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
}

const healthGuidance = {
  Asthma: 'keep prescribed inhalers nearby and avoid smoke or strenuous activity when symptoms increase',
  'Heart Problems': 'avoid strenuous exertion in poor air quality and follow the care plan provided by your clinician',
  Allergies: 'limit exposure to dust, smoke, and other known triggers and monitor symptoms',
  'No issues': 'continue monitoring conditions and reduce prolonged exposure if pollution rises'
};

const occupationGuidance = {
  'Outdoor Worker': 'reduce prolonged outdoor exertion and take breaks in cleaner air',
  'Indoor Worker': 'keep indoor air clean and limit time near polluted entrances',
  Student: 'move intense outdoor activities indoors when air quality is elevated',
  Athlete: 'move training indoors when AQI is elevated and avoid intense exertion during alerts',
  'Delivery Worker': 'plan routes around high-pollution periods and use a well-fitting mask outdoors'
};

const ageGuidance = {
  'Under 18': 'Because you are under 18, keep outdoor exposure shorter and involve a parent or guardian when symptoms appear',
  '18-25 Years': 'As a young adult, pace intense activity and pay attention to early symptoms',
  '26-40 Years': 'Balance work demands with regular breaks and avoid pushing through breathing or chest symptoms',
  '41-60 Years': 'Take regular recovery breaks and monitor how your body responds to pollution and exertion',
  '60+ Years': 'Use extra caution during pollution alerts and ask a clinician about changes in symptoms or activity'
};

const activityGuidance = {
  Low: 'keep normal light activity, but avoid long periods outdoors when conditions worsen',
  Moderate: 'choose shorter sessions and take breaks in cleaner air',
  High: 'reduce intense exertion first and move demanding activity indoors during alerts'
};

const conditionActions = {
  Asthma: 'Keep your prescribed inhaler accessible and stop activity if wheezing or breathlessness increases',
  'Heart Problems': 'Avoid strenuous exertion during an AQI alert and follow your clinician\'s heart-care plan',
  Allergies: 'Avoid dust, smoke, and other known triggers, and monitor allergy symptoms',
  'No issues': 'Continue normal precautions and reduce prolonged exposure if pollution worsens'
};

const occupationActions = {
  'Outdoor Worker': 'Take scheduled breaks in cleaner air and use a well-fitting mask during outdoor work',
  'Indoor Worker': 'Keep indoor air filtered or ventilated and take breaks away from polluted entrances',
  Student: 'Move sports and other strenuous school activities indoors when the AQI is elevated',
  Athlete: 'Move training indoors during alerts and reduce intensity instead of training through symptoms',
  'Delivery Worker': 'Plan deliveries outside peak-pollution periods and use a well-fitting mask on routes'
};

// Serve front-end on root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// Update Profile API
app.post('/api/profile', (req, res) => {
  const { ageGroup, healthCondition, occupation, activityLevel } = req.body;
  if (![ageGroup, healthCondition, occupation, activityLevel].every(value => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ error: 'A complete profile is required' });
  }
  userProfile = { ageGroup, healthCondition, occupation, activityLevel };
  res.json({ message: "Profile updated successfully", profile: userProfile });
});

// Get Profile API
app.get('/api/profile', (req, res) => {
  res.json(userProfile);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Search Location & Generate AI Advisory API
app.post('/api/dashboard-data', async (req, res) => {
  try {
    const { city } = req.body;
    const requestedProfile = req.body.profile;
    const advisoryProfile = requestedProfile && typeof requestedProfile === 'object'
      ? {
          ageGroup: requestedProfile.ageGroup || userProfile.ageGroup,
          healthCondition: requestedProfile.healthCondition || userProfile.healthCondition,
          occupation: requestedProfile.occupation || userProfile.occupation,
          activityLevel: requestedProfile.activityLevel || userProfile.activityLevel
        }
      : { ...userProfile };
    if (typeof city !== 'string' || !city.trim()) {
      return res.status(400).json({ error: "City name is required" });
    }

    // 1. Geocode City Name via Open-Meteo
    const geoRes = await getWithRetry(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
    );

    if (!geoRes.data.results || geoRes.data.results.length === 0) {
      return res.status(404).json({ error: "City not found" });
    }
    const { latitude: lat, longitude: lon, name: locationName } = geoRes.data.results[0];

    // 2. Fetch live weather and coordinate-specific AQI concurrently
    const [weatherRes, aqiRes] = await Promise.all([
      getWithRetry(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code`
      ),
      getWithRetry(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5,pm10`
      )
    ]);

    const weatherData = weatherRes.data.current;
    const aqiData = aqiRes.data.current;
    const aqi = Number(aqiData.us_aqi);
    if (!Number.isFinite(aqi)) {
      throw new Error('AQI data is unavailable for this location');
    }

    const liveEnvironment = {
      location: locationName,
      temperature: weatherData.temperature_2m,
      feelsLike: weatherData.apparent_temperature,
      humidity: weatherData.relative_humidity_2m,
      windSpeed: weatherData.wind_speed_10m,
      weatherCode: weatherData.weather_code,
      aqi,
      aqiStatus: getAQIStatus(aqi),
      pm25: Number.isFinite(Number(aqiData.pm2_5)) ? aqiData.pm2_5 : "N/A",
      pm10: Number.isFinite(Number(aqiData.pm10)) ? aqiData.pm10 : "N/A"
    };

    // 3. Generate Advisory via Groq LLM (with local fallback)
    async function generateLocalAdvisory(env, profile) {
      const severity = env.aqi <= 50 ? 'low' : env.aqi <= 100 ? 'moderate' : env.aqi <= 150 ? 'elevated' : env.aqi <= 200 ? 'high' : 'very high';
      const conditionAdvice = healthGuidance[profile.healthCondition] || 'monitor symptoms and follow your personal care plan';
      const conditionAction = conditionActions[profile.healthCondition] || 'Monitor symptoms and follow your personal care plan';
      const occupationAdvice = occupationGuidance[profile.occupation] || 'take regular breaks and limit prolonged exposure';
      const occupationAction = occupationActions[profile.occupation] || 'Take regular breaks and limit prolonged exposure';
      const ageAdvice = ageGuidance[profile.ageGroup] || 'adjust exposure to your comfort and follow your personal care plan';
      const activityAdvice = activityGuidance[profile.activityLevel] || 'take regular breaks and limit prolonged exposure';
      const summary = `Air quality in ${env.location} is ${env.aqi} (${env.aqiStatus}). For a ${profile.ageGroup.toLowerCase()} ${profile.healthCondition.toLowerCase()} person working as a ${profile.occupation.toLowerCase()} with ${profile.activityLevel.toLowerCase()} activity, ${conditionAdvice}. ${occupationAdvice}, and ${activityAdvice}.`;
      const bullets = [];
      bullets.push(`Activity (${profile.activityLevel}) and AQI (${env.aqi}): ${activityAdvice}.`);
      bullets.push(`Health condition (${profile.healthCondition}): ${conditionAction}.`);
      bullets.push(`Occupation (${profile.occupation}): ${occupationAction}.`);
      bullets.push(`Age group (${profile.ageGroup}): ${ageAdvice}. If you develop chest pain, severe breathlessness, or worsening symptoms, seek medical care.`);
      return { summary, bullets };
    }

    let advisory;
    if (!process.env.GROQ_API_KEY) {
      console.warn('GROQ_API_KEY not set — using local advisory fallback');
      advisory = await generateLocalAdvisory(liveEnvironment, advisoryProfile);
    } else {
      try {
        const prompt = `
          You are AirWise AI generating custom health advice based on live weather and AQI metrics.

          User Profile:
          - Age Group: ${advisoryProfile.ageGroup}
          - Health Condition: ${advisoryProfile.healthCondition}
          - Occupation: ${advisoryProfile.occupation}
          - Activity Level: ${advisoryProfile.activityLevel}

          Live Environmental Data:
          - Location: ${liveEnvironment.location}
          - Temperature: ${liveEnvironment.temperature}°C (Feels like ${liveEnvironment.feelsLike}°C)
          - AQI: ${liveEnvironment.aqi} (${liveEnvironment.aqiStatus})
          - PM2.5: ${liveEnvironment.pm25} µg/m³, PM10: ${liveEnvironment.pm10} µg/m³

          Task: Return strictly valid JSON containing personalized advice. The summary and every bullet must specifically address the selected health condition and occupation; do not use generic advice when a specific recommendation is possible.
          Return strictly valid JSON containing:
          1. "summary": A personalized 2-sentence health warning addressing their specific condition and occupation.
          2. "bullets": An array of exactly 4 concise, actionable advice points.
        `;

        const aiCompletion = await groq.chat.completions.create({
          messages: [
            { role: "system", content: "Output strictly valid JSON only." },
            { role: "user", content: prompt }
          ],
          model: "llama-3.1-8b-instant",
          response_format: { type: "json_object" }
        });

        // Try to parse model output; fallback to local generator on failure
        try {
          advisory = JSON.parse(aiCompletion.choices[0].message.content);
        } catch (err) {
          console.error('Failed to parse Groq response, using fallback:', err.message);
          advisory = await generateLocalAdvisory(liveEnvironment, advisoryProfile);
        }
      } catch (err) {
        console.error('Groq API failed — using local advisory fallback:', err.message);
        advisory = await generateLocalAdvisory(liveEnvironment, advisoryProfile);
      }
    }

    res.json({
      profile: advisoryProfile,
      environment: liveEnvironment,
      advisory: advisory
    });

  } catch (error) {
    console.error("Error generating dashboard data:", error.message);
    res.status(500).json({
      error: "Failed to generate dashboard data",
      ...(isProduction ? {} : { details: error.message })
    });
  }
});

// Start Server
const server = app.listen(port, host, () => {
  console.log(`Server listening on ${host}:${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));