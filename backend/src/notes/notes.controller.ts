import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { NotesService } from './notes.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { User, AuthenticatedUser } from '../auth/user.decorator';

@Controller('notes')
@UseGuards(JwtAuthGuard)
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Post()
  createNote(@User() user: AuthenticatedUser, @Body() body: { title: string; content: string }) {
    return this.notesService.createNote(user.id, body.title, body.content);
  }

  @Put(':id')
  updateNote(
    @User() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { title: string; content: string },
  ) {
    return this.notesService.updateNote(user.id, id, body.title, body.content);
  }

  @Get()
  getNotes(@User() user: AuthenticatedUser) {
    return this.notesService.getNotes(user.id);
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
