const express = require('express');
const mongoose = require('mongoose');
const { google } = require('googleapis');
require('dotenv').config();
const uuid = require('uuid').v4;

const PORT=3000;

const Event = require('./models/event'); // Import the Event model

const app = express();
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log(err));

const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// Middleware to ensure valid token
async function ensureValidToken(req, res, next) {
    try {
        if (!oAuth2Client.credentials.refresh_token) {
            return res.status(401).send('No refresh token available.');
        }

        const tokenInfo = await oAuth2Client.getTokenInfo(oAuth2Client.credentials.access_token);
        
        // Check if the access token is expired
        if (tokenInfo.expiry_date <= Date.now()) {
            await refreshAccessToken();
        }
        next();
    } catch (error) {
        console.error('Error checking token validity:', error);
        res.status(500).send('Internal Server Error');
    }
}

// Function to refresh access token
async function refreshAccessToken() {
    try {
        const { credentials } = await oAuth2Client.refreshAccessToken();
        console.log('New Access Token:', credentials.access_token);
        
        // Save new tokens (access_token and refresh_token) securely
        oAuth2Client.setCredentials({
            access_token: credentials.access_token,
            refresh_token: process.env.GOOGLE_REFRESH_TOKEN // Ensure this remains unchanged
        });
    } catch (error) {
        console.error('Error refreshing access token:', error);
        // Handle reauthorization if needed
        if (error.response && error.response.data && error.response.data.error === 'invalid_grant') {
            console.error('Refresh token may be invalid or revoked.');
            // Optionally prompt user to reauthorize
        }
    }
}

// make testing rout    
app.get('/test', ensureValidToken, (req, res) => {
    res.send('Hello, World!! It\'s me Soni')
    });


// Route to start authorization flow
app.get('/auth', (req, res) => {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/calendar'],
    });
    res.redirect(authUrl);
});

// Callback route after authorization
app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    const { tokens } = await oAuth2Client.getToken(code);
    
    // Save tokens securely
    oAuth2Client.setCredentials(tokens);
    
    console.log('Tokens acquired:', tokens);
    
    // Save the refresh token for future use
    process.env.GOOGLE_REFRESH_TOKEN = tokens.refresh_token; // Store securely in your database or environment

    
    watchCalendar(); // Start watching calendar events when server starts

    res.send('Authorization successful! You can call google all events api.');
});

const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

// Fetch all events from Google Calendar and save them to MongoDB
app.post('/google/all/events', ensureValidToken, async (req, res) => {
    calendar.events.list({
        calendarId: 'primary',
        singleEvents: true,
        orderBy: 'startTime',
    }, async (err, response) => {
        if (err) return res.status(500).send("The API returned an error: " + err);

        const events = response.data.items;
        
        for (let event of events) {
            const existingEvent = await Event.findOne({ id: event.id });
            if (!existingEvent) {
                const newEvent = new Event({
                    id: event.id,
                    start: event.start.dateTime || event.start.date,
                    end: event.end.dateTime || event.end.date,
                    status: event.status,
                    creator: event.creator || [],
                    description: event.summary || ''
                });
                await newEvent.save();
            }
        }
        
        res.status(200).send("Events fetched and saved successfully.");
    });
});

// Webhook endpoint to receive notifications
app.post('/notifications', ensureValidToken, async (request, reply) => {
    const resourceState = request.headers['x-goog-resource-state'];
    // console.log("********",resourceState);

    if (resourceState === 'sync') {
        return reply.status(200).send();
    }

    const eventResponse = await calendar.events.list({
        calendarId: 'primary',
        singleEvents: true,
        orderBy: 'updated',
    });

    const changedEvent=eventResponse.data.items.pop();
    console.log("!!!!!!!!!!!!!!!!!!!-------------------->>>>>>>>>>>",changedEvent);
    handleEventChange(changedEvent);
    return reply.status(200).send('Webhook received');
});

// Function to handle event changes
async function handleEventChange(event) {
    if (event.status === 'cancelled') {
        await deleteEventFromDatabase(event.id);
    } else {
        const existingEvent = await Event.findOne({ id: event.id });
        
        if (!existingEvent) {
            await createEventInDatabase(event);
        } else {
            await updateEventInDatabase(event);
        }
    }
}

// Database operation functions
async function createEventInDatabase(event) {
    console.log(`Creating event in DB: ${event.summary}`);
    
    const newEvent = new Event({
        id: event.id,
        start: event.start.dateTime || event.start.date,
        end: event.end.dateTime || event.end.date,
        status: event.status,
        creator: event.creator || {},
        description: event.summary || ''
    });
    
    await newEvent.save();
}

async function updateEventInDatabase(event) {
    console.log(`Updating event in DB: ${event.summary}`);
    
    await Event.updateOne(
        { id: event.id },
        {
            start: event.start.dateTime || event.start.date,
            end: event.end.dateTime || event.end.date,
            status: event.status,
            creator: event.creator || {},
            description: event.summary || ''
        }
    );
}

async function deleteEventFromDatabase(eventId) {
    console.log(`Deleting event from DB with ID: ${eventId}`);
    
    await Event.deleteOne({ id: eventId });
}

// Function to watch calendar events
async function watchCalendar() {
    const requestBody = {
        id: uuid(), // Unique channel ID
        type: 'web_hook',
        address: 'https://bfcf-49-36-81-181.ngrok-free.app/notifications', // Your webhook URL
        token: 'optional_token', // Optional token for your application
        params: {
            ttl: '3600' // Time-to-live in seconds
        }
    };

    try {
        const response = await calendar.events.watch({
            calendarId: 'primary',
            requestBody,
        });
        console.log('Watch response -------------------->>>>>>>>>>>:', response);
    } catch (error) {
        console.error('Error setting up watch:', error);
    }
}

// Start the server and set up the watch on startup
app.listen(PORT, () => {
    console.log(`Versal Server is running on port ${PORT}`);
});