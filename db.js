// db.js

const { Sequelize, DataTypes } = require('sequelize');

// Настройка подключения к SQLite
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './database.sqlite', // Путь к файлу базы данных
    define: {
        freezeTableName: true, // Убирает автоматическое добавление 's' к имени таблицы
        timestamps: false       // Убирает поля временных меток
    },
    logging: false              // Отключение логирования запросов
});

// Определение модели User
const User = sequelize.define('User', {
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    }
    // Добавьте другие нужные поля здесь
});

// Функция для получения пользователя по имени

// Синхронизация модели с базой данных
sequelize.authenticate()
    .then(() => console.log('Подключение к SQLite установлено'))
    .then(() => sequelize.sync()) // Убедимся, что синхронизация выполнена после подключения
    .then(() => console.log('Модель User синхронизирована с базой данных SQLite'))
    .catch(error => console.error('Ошибка синхронизации модели с SQLite:', error));

// Экспорт sequelize и функций
module.exports = {
    sequelize,
    User,
};