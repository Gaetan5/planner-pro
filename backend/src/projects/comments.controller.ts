import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CreateCommentDto } from './dto/create-comment.dto';
import { TrackingGateway } from '../tracking/tracking.gateway';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(
    private readonly commentsService: CommentsService,
    private readonly trackingGateway: TrackingGateway,
  ) {}

  /**
   * Ajoute un commentaire sur une tâche et le notifie en temps réel.
   */
  @Post('tasks/:taskId/comments')
  async createComment(
    @Req() req: any,
    @Param('taskId') taskId: string,
    @Body() body: CreateCommentDto,
  ) {
    const result = await this.commentsService.createComment(
      taskId,
      req.user.id,
      body.content,
      body.parentId,
      body.attachments,
    );

    // Diffuser le commentaire en temps réel via WebSockets à la room de la tâche
    if (this.trackingGateway.server) {
      this.trackingGateway.server.to(`task:${taskId}`).emit('new-comment', {
        comment: result.comment,
        taskId,
      });

      // Notifier individuellement chaque utilisateur mentionné
      for (const mentionedUserId of result.mentionedUserIds) {
        // Optionnel : éviter de notifier l'auteur lui-même
        if (mentionedUserId !== req.user.id) {
          this.trackingGateway.server.to(`user:${mentionedUserId}`).emit('mention-notification', {
            taskId,
            comment: result.comment,
            message: `${req.user.name || req.user.email} vous a mentionné dans un commentaire.`,
          });
        }
      }
    }

    return result.comment;
  }

  /**
   * Liste les commentaires d'une tâche.
   */
  @Get('tasks/:taskId/comments')
  async listComments(@Req() req: any, @Param('taskId') taskId: string) {
    return this.commentsService.listComments(taskId, req.user.id);
  }

  /**
   * Supprime un commentaire.
   */
  @Delete('comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteComment(@Req() req: any, @Param('commentId') commentId: string) {
    const deletedComment = await this.commentsService.deleteComment(commentId, req.user.id);

    // Diffuser la suppression en temps réel
    if (this.trackingGateway.server) {
      this.trackingGateway.server.to(`task:${deletedComment.taskId}`).emit('comment-deleted', {
        commentId,
        taskId: deletedComment.taskId,
      });
    }
  }

  /**
   * Modifie un commentaire et diffuse le changement.
   */
  @Put('comments/:commentId')
  async updateComment(
    @Req() req: any,
    @Param('commentId') commentId: string,
    @Body() body: CreateCommentDto,
  ) {
    const result = await this.commentsService.updateComment(commentId, req.user.id, body.content);

    // Diffuser le commentaire mis à jour en temps réel via WebSockets à la room de la tâche
    if (this.trackingGateway.server) {
      this.trackingGateway.server.to(`task:${result.comment.taskId}`).emit('comment-updated', {
        comment: result.comment,
        taskId: result.comment.taskId,
      });

      // Notifier individuellement chaque utilisateur mentionné
      for (const mentionedUserId of result.mentionedUserIds) {
        if (mentionedUserId !== req.user.id) {
          this.trackingGateway.server.to(`user:${mentionedUserId}`).emit('mention-notification', {
            taskId: result.comment.taskId,
            comment: result.comment,
            message: `${req.user.name || req.user.email} vous a mentionné dans un commentaire modifié.`,
          });
        }
      }
    }

    return result.comment;
  }

  @Post('tasks/:taskId/attachments')
  async createAttachment(
    @Req() req: any,
    @Param('taskId') taskId: string,
    @Body() body: { fileName: string; fileUrl: string; fileType: string; fileSize: number },
  ) {
    return this.commentsService.createAttachmentForTask(
      taskId,
      req.user.id,
      body.fileName,
      body.fileUrl,
      body.fileType,
      body.fileSize,
    );
  }

  @Get('tasks/:taskId/attachments')
  async getAttachments(@Req() req: any, @Param('taskId') taskId: string) {
    return this.commentsService.getAttachmentsForTask(taskId, req.user.id);
  }

  @Delete('attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAttachment(@Req() req: any, @Param('attachmentId') attachmentId: string) {
    await this.commentsService.deleteAttachment(attachmentId, req.user.id);
  }
}
