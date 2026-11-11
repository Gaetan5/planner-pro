import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { UuidPipe } from '../common/uuid.pipe';
import { NotesService } from './notes.service';
import { User, AuthenticatedUser } from '../auth/user.decorator';
import { NoteDto } from './dto/note.dto';

@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Post()
  createNote(@User() user: AuthenticatedUser, @Body() body: NoteDto) {
    return this.notesService.createNote(user.id, body.title, body.content);
  }

  @Put(':id')
  updateNote(
    @User() user: AuthenticatedUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: NoteDto,
  ) {
    return this.notesService.updateNote(user.id, id, body.title, body.content);
  }

  @Get()
  getNotes(@User() user: AuthenticatedUser) {
    return this.notesService.getNotes(user.id);
  }

  @Get(':id')
  getNote(@User() user: AuthenticatedUser, @Param('id', UuidPipe) id: string) {
    return this.notesService.getNote(user.id, id);
  }

  @Delete(':id')
  deleteNote(@User() user: AuthenticatedUser, @Param('id', UuidPipe) id: string) {
    return this.notesService.deleteNote(user.id, id);
  }
}
