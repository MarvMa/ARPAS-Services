import {Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn} from 'typeorm';

@Entity('recordings')
export class Recording {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    originalFilename: string;

    @Column()
    color: string;

    @Column('float')
    duration: number;

    @Column('integer')
    pointCount: number;

    @Column('json')
    bounds: {
        minLat: number;
        maxLat: number;
        minLon: number;
        maxLon: number;
    };

    @Column('json', {nullable: true})
    metadata?: {
        deviceId?: string;
        deviceName?: string;
        platform?: string;
        appVersion?: string;
        recordingTime?: string;
        timezone?: string;
    };

    @Column()
    filePath: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}