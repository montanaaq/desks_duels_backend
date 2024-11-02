const { sequelize } = require('./db');
const express = require('express');
const app = express();
const cors = require('cors');

require('dotenv').config();

const { initializeSeats } = require('./services/initializeSeats');

const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const seatsRouter = require('./routes/seats');
const duelsRouter = require('./routes/duels');

app.use(express.json());
app.use(cors());

// Импорт и подключение маршрутов
const authRoutes = require('./routes/authRoutes');
app.use('/', indexRouter)
app.use('/auth', authRoutes);
app.use('/users', usersRouter);
app.use('/seats', seatsRouter);
app.use('/duels', duelsRouter);

// Синхронизация базы данных и запуск сервера
sequelize.sync().then(async () => {
    await initializeSeats(); // Инициализация мест
    app.listen(3000, () => {
        console.log('Server is running on http://localhost:3000, Press Ctrl+C to quit.');
    });
}).catch(error => console.error('Error syncing database:', error));
