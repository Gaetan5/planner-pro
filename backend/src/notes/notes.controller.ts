import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { NotesService } from './notes.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('notes')
@UseGuards(JwtAuthGuard)
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Post()
  createNote(@Req() req: any, @Body() body: { title: string; content: string }) {
    return this.notesService.createNote(req.user.id, body.title, body.content);
  }

  @Put(':id')
  updateNote(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { title: string; content: string },
  ) {
    return this.notesService.updateNote(req.user.id, id, body.title, body.content);
  }

  @Get()
  getNotes(@Req() req: any) {
    return this.notesService.getNotes(req.user.id);
  }

  @Get(':id')
  getNote(@Param('id') id: string) {
    return this.notesService.getNote(id);
  }

  @Delete(':id')
  deleteNote(@Param('id') id: string) {
    return this.notesService.deleteNote(id);
  }
}
