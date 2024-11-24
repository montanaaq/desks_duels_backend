// models/User.js

const { Model } = require('sequelize');

class User extends Model {
    static init(sequelize, DataTypes) {
        if (!sequelize) {
            throw new Error('Sequelize instance must be provided');
        }
        
        if (!DataTypes) {
            throw new Error('DataTypes must be provided');
        }

        return super.init({
            telegramId: {
                type: DataTypes.STRING,
                primaryKey: true,
                unique: true
            },
            name: {
                type: DataTypes.STRING,
                allowNull: false
            },
            username: {
                type: DataTypes.STRING,
                allowNull: true
            },
            rules_seen: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            },
            currentSeat: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            dueling: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            }
        }, {
            sequelize,
            modelName: 'User',
            timestamps: true
        });
    }

    static associate(models) {
        // Safely check and set up associations
        if (models.Duel) {
            this.hasMany(models.Duel, { 
                foreignKey: 'player1', 
                as: 'initiatedDuels' 
            });
            this.hasMany(models.Duel, { 
                foreignKey: 'player2', 
                as: 'receivedDuels' 
            });
        }
        
        if (models.Seats) {
            this.belongsTo(models.Seats, { 
                foreignKey: 'currentSeat', 
                as: 'seat' 
            });
        }
    }
}

module.exports = User;
