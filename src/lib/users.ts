import { ObjectId, type Filter } from "mongodb";

export type UserDocument = {
  _id?: string | ObjectId;
  id?: string;
  name?: string;
  email?: string;
  image?: string | null;
  role?: unknown;
  vendorStatus?: unknown;
  vendorAppliedAt?: Date;
  vendorApprovedAt?: Date;
  status?: unknown;
  plan?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

export function userFilterById(id: string): Filter<UserDocument> {
  const clauses: Filter<UserDocument>[] = [{ _id: id }, { id }];
  if (ObjectId.isValid(id)) clauses.push({ _id: new ObjectId(id) });
  return { $or: clauses };
}
