import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

interface GuardUser {
  id: string;
  roles?: string[];
  companyId?: string;
  membershipRole?: string;
  [key: string]: unknown;
}

/**
 * Loads a bank import from `:id` and verifies the caller belongs to the
 * import's company. Unknown and foreign imports both yield 404.
 */
@Injectable()
export class BankImportGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params: Record<string, string | undefined>;
      user?: GuardUser;
    }>();
    const importId = request.params['id'];
    const userId = request.user?.id;
    if (!importId || !userId) {
      throw new NotFoundException('Import not found');
    }
    const bankImport = await this.prisma.bankImport.findUnique({
      where: { id: importId },
    });
    if (!bankImport) {
      throw new NotFoundException('Import not found');
    }
    const membership = await this.prisma.companyUser.findUnique({
      where: {
        userId_companyId: { userId, companyId: bankImport.companyId },
      },
    });
    if (!membership) {
      throw new NotFoundException('Import not found');
    }
    request.user = {
      ...request.user,
      id: userId,
      roles: [membership.role],
      companyId: bankImport.companyId,
      membershipRole: membership.role,
    };
    return true;
  }
}
