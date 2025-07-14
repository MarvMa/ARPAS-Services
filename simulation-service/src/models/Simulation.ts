import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Recording } from './Recording';

@Entity('simulations')
export class Simulation {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column('json')
    recordingIds: string[];

    @Column('json', { nullable: true })
    settings?: {
        speed?: number;
        loop?: boolean;
        startTime?: Date;
    };

    @CreateDateColumn()
    createdAt: Date;
}